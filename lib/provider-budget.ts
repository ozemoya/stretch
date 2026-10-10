import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
const directory=path.join(process.cwd(),".price-jobs");
let budgetQueue:Promise<void> = Promise.resolve();
export async function reserveRecords(records:number) {
  const previous=budgetQueue;
  let release!:()=>void;
  budgetQueue=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try {
    await mkdir(directory,{recursive:true});
    const filename=path.join(directory,"_record-budget.json");
    const month=new Date().toISOString().slice(0,7);
    let used=0;
    try {const saved=JSON.parse(await readFile(filename,"utf8"));if(saved.month===month)used=saved.reservedRecords;} catch {}
    if(!Number.isFinite(used) || used+records>1000)throw new Error("Monthly collection allowance reached. Existing prices remain available.");
    await writeFile(filename,JSON.stringify({month,reservedRecords:used+records,limit:1000}));
  } finally {release();}
}
