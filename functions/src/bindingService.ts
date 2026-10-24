import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const db = admin.firestore();
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GROUP_REQUEST_TTL_MS = 20 * 60 * 1000;

export interface BindingActor {
  volunteerId: string;
  role: string;
  managedTeams: string[];
}

interface RosterMember {
  id: string;
  name: string;
  jobTitles: string[];
  lineId: string;
  isActive: boolean;
}

function toMember(snapshot: admin.firestore.DocumentSnapshot): RosterMember {
  const data = snapshot.data() as Record<string, unknown>;
  return {
    id: snapshot.id,
    name: typeof data.name === 'string' ? data.name : snapshot.id,
    jobTitles: Array.isArray(data.jobTitles) ? data.jobTitles.filter((v): v is string => typeof v === 'string') : [],
    lineId: typeof data.lineId === 'string' ? data.lineId : '',
    isActive: data.isActive !== false,
  };
}

function mayManage(actor: BindingActor, member: RosterMember): boolean {
  return actor.role === 'super_admin' || member.jobTitles.some(team => actor.managedTeams.includes(team));
}

export async function createBindingInvite(actor: BindingActor, volunteerId: string): Promise<{ token: string; expiresAt: Date }> {
  const memberSnapshot = await db.collection('volunteers').doc(volunteerId).get();
  if (!memberSnapshot.exists) throw new Error('找不到名冊成員');
  const member = toMember(memberSnapshot);
  if (!member.isActive) throw new Error('此名冊成員已退出');
  if (member.lineId) throw new Error('此名冊成員已完成 LINE 綁定');
  if (!mayManage(actor, member)) throw new Error('您沒有管理此名冊成員的權限');

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invitation = db.collection('binding_invites').doc();
  await invitation.set({
    volunteerId,
    tokenHash,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    usedAt: null,
    revokedAt: null,
    createdBy: actor.volunteerId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { token, expiresAt };
}

export async function redeemBindingInvite(token: string, lineId: string): Promise<{ volunteerId: string }> {
  if (!token || !lineId) throw new Error('綁定資訊不完整');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const inviteSnapshot = await db.collection('binding_invites').where('tokenHash', '==', tokenHash).limit(1).get();
  if (inviteSnapshot.empty) throw new Error('邀請連結無效');

  const inviteRef = inviteSnapshot.docs[0].ref;
  let boundVolunteerId = '';
  await db.runTransaction(async transaction => {
    const invite = await transaction.get(inviteRef);
    const data = invite.data() as Record<string, unknown>;
    const expiresAt = data.expiresAt as admin.firestore.Timestamp | undefined;
    if (data.usedAt || data.revokedAt || !expiresAt || expiresAt.toMillis() <= Date.now()) {
      throw new Error('邀請連結已失效、已使用或已作廢');
    }
    const volunteerId = typeof data.volunteerId === 'string' ? data.volunteerId : '';
    const volunteerRef = db.collection('volunteers').doc(volunteerId);
    const volunteer = await transaction.get(volunteerRef);
    if (!volunteer.exists) throw new Error('名冊成員已不存在');
    const member = toMember(volunteer);
    if (!member.isActive || member.lineId) throw new Error('此名冊成員目前無法綁定');

    const existing = await transaction.get(db.collection('volunteers').where('lineId', '==', lineId).limit(1));
    if (!existing.empty) throw new Error('此 LINE 帳號已綁定其他名冊成員');

    transaction.update(volunteerRef, { lineId, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    transaction.update(inviteRef, { usedAt: admin.firestore.FieldValue.serverTimestamp(), usedLineId: lineId });
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'line_binding_redeemed', volunteerId, lineId, inviteId: inviteRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    boundVolunteerId = volunteerId;
  });
  return { volunteerId: boundVolunteerId };
}

export async function createGroupBindingRequest(actor: BindingActor, targetLineId: string): Promise<{ requestId: string }> {
  if (actor.role !== 'super_admin' && actor.role !== 'team_lead') throw new Error('您沒有執行綁定的權限');
  if (!targetLineId) throw new Error('找不到被標記的 LINE 帳號');
  const alreadyBound = await db.collection('volunteers').where('lineId', '==', targetLineId).limit(1).get();
  if (!alreadyBound.empty) throw new Error('此 LINE 帳號已完成綁定');
  const request = db.collection('binding_requests').doc();
  await request.set({
    requesterVolunteerId: actor.volunteerId,
    targetLineId,
    managedTeams: actor.managedTeams,
    expiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + GROUP_REQUEST_TTL_MS)),
    completedAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { requestId: request.id };
}

export async function listGroupBindingCandidates(actor: BindingActor, requestId: string): Promise<Array<{ volunteerId: string; name: string; teams: string[] }>> {
  const request = await db.collection('binding_requests').doc(requestId).get();
  const data = request.data() as Record<string, unknown> | undefined;
  const expiresAt = data?.expiresAt as admin.firestore.Timestamp | undefined;
  if (!request.exists || data?.requesterVolunteerId !== actor.volunteerId || !expiresAt || expiresAt.toMillis() <= Date.now() || data.completedAt) {
    throw new Error('此綁定操作已失效');
  }
  const roster = await db.collection('volunteers').get();
  return roster.docs
    .map(toMember)
    .filter(member => member.isActive && !member.lineId && mayManage(actor, member))
    .map(member => ({ volunteerId: member.id, name: member.name, teams: member.jobTitles }));
}

export async function completeGroupBindingRequest(actor: BindingActor, requestId: string, volunteerId: string): Promise<void> {
  const requestRef = db.collection('binding_requests').doc(requestId);
  await db.runTransaction(async transaction => {
    const request = await transaction.get(requestRef);
    const data = request.data() as Record<string, unknown> | undefined;
    const expiresAt = data?.expiresAt as admin.firestore.Timestamp | undefined;
    if (!request.exists || data?.requesterVolunteerId !== actor.volunteerId || !expiresAt || expiresAt.toMillis() <= Date.now() || data.completedAt) {
      throw new Error('此綁定操作已失效');
    }
    const targetLineId = typeof data.targetLineId === 'string' ? data.targetLineId : '';
    const volunteerRef = db.collection('volunteers').doc(volunteerId);
    const volunteer = await transaction.get(volunteerRef);
    if (!volunteer.exists) throw new Error('找不到名冊成員');
    const member = toMember(volunteer);
    if (!member.isActive || member.lineId || !mayManage(actor, member)) throw new Error('此名冊成員目前無法綁定');
    const existing = await transaction.get(db.collection('volunteers').where('lineId', '==', targetLineId).limit(1));
    if (!existing.empty) throw new Error('此 LINE 帳號已完成綁定');
    transaction.update(volunteerRef, { lineId: targetLineId, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    transaction.update(requestRef, { completedAt: admin.firestore.FieldValue.serverTimestamp(), volunteerId });
    transaction.set(db.collection('audit_logs').doc(), {
      action: 'line_group_binding_completed', volunteerId, targetLineId, requesterVolunteerId: actor.volunteerId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}
