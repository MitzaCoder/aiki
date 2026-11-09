/** Configure/record a fresh owned4795 scratch project; actual tools are initiated later natively. */
import assert from "node:assert/strict";
import {connect} from "./wire.ts";
if(process.argv[2]!==undefined&&process.argv[2]!=="literal")throw Error("Only optional literal setup is supported");
const literal=process.argv[2]==="literal",origin=`http://127.0.0.1:${literal?4796:4795}`,c=await connect(origin);await c.request("hello",{protocolVersion:1});
try {
 const projects=(await c.request("projects.list",{})).projects;assert.equal(projects.length,1);const p=projects[0];assert(/^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(p.path));
 assert.equal((await c.request("threads.list",{projectId:p.id})).threads.filter((t:any)=>!t.main).length,0,"Refusing to configure a populated visual run");
 const model=(await c.request("models.list",{})).models.find((m:any)=>m.provider==="faux");assert(model?.configured&&model.name.includes("deliberately long name"),"Start with ANDROID_VERIFY_LONG_MODEL=1");
 await c.request("projects.configure",{projectId:p.id,name:literal?"Native copy proof (faux)":"Native visual states (faux)"});
 const result={projectId:p.id,path:p.path,origin,model:"faux with long display name",purpose:"actual real-tool visual states; original4790 native proof preserved",preparedAt:new Date().toISOString()};
 await Bun.write(`/tmp/harness-verification/scratch/android-screens/ROUND2/${literal?"literal-real-project":"visual-real-project"}.json`,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
}finally{c.close();}
