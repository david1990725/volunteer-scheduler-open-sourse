const XLSX = require('xlsx');

const text = `Name,User_ID,Job_Title,Skill_Role,D_Skill,AD_Skill,Cam1_Skill,Cam2_Skill,Cam3_Skill,Cam4_Skill,Photo_Skill,User_Level,Avatar
康恩得,,影視,"Cam2, Photo",0,3,4,5,5,5,10,user,
樊家琪,,影視,Photo,0,0,0,0,0,0,6,user,`;

const workbook = XLSX.read(text, { type: 'string' });
const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
console.log(json);

for (const row of json) {
    const name = row['Name']?.trim() || row['姓名']?.trim();
    console.log("Parsed Name:", name);
    const roles = (row['Job_Title'] || row['Skill_Role'] || row['職能'] || '').split(',').map((r) => r.trim()).filter(Boolean);
    console.log("Roles:", roles);
}
