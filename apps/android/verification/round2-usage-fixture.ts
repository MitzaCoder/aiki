/** Read-only, explicitly synthetic Usage/account appearance source. Never a provider verification. */
import {ServerMessageSchema} from "../../../packages/protocol/src/index.ts";
import {Value} from "../../../packages/protocol/node_modules/typebox/build/value/index.mjs";
const port=Number(process.env.PORT??4794);
if(port<4791||port>4799)throw Error("Use an isolated loopback verification port");
let refreshes=0;
function subscription(providerId:string,label:string,used:number) {
 const now=Date.now(),iso=new Date(now).toISOString(),ago=(minutes:number)=>new Date(now-minutes*60000).toISOString();
 return {providerId,label:label+" · SYNTHETIC",plan:"Reference plan",account:"SYNTHETIC account · no provider login",source:"usage_api",updatedAt:iso,error:null,windows:[
 {id:"five_hour",label:"5-hour limit",usedPercent:used,resetsAt:new Date(now+150*60000).toISOString(),windowMinutes:300,samples:[{at:ago(150),usedPercent:0},{at:ago(100),usedPercent:used*.3},{at:ago(50),usedPercent:used*.65},{at:iso,usedPercent:used}]},
 {id:"seven_day",label:"Weekly limit",usedPercent:28,resetsAt:new Date(now+4*24*60*60000).toISOString(),windowMinutes:10080,samples:[{at:ago(3*24*60),usedPercent:0},{at:ago(24*60),usedPercent:19},{at:iso,usedPercent:28}]}
 ]};
}
Bun.serve({hostname:"127.0.0.1",port,fetch(req,server){if(new URL(req.url).pathname==="/ws"&&server.upgrade(req))return;return new Response("SYNTHETIC usage appearance only");},websocket:{message(ws,raw){
 const q=JSON.parse(String(raw));let data:Record<string,unknown>;
 switch(q.type){
 case "hello":data={protocolVersion:1,server:{name:"SYNTHETIC usage only",version:"round2"},features:["projects","models","credentials","logins","subscription-usage"]};break;
 case "projects.list":data={projects:[]};break;
 case "models.list":data={models:[],providers:[{id:"anthropic",name:"Claude · SYNTHETIC",configured:false,oauth:{name:"Claude Pro/Max",loginLabel:"Sign in with Claude",isSubscription:true}},{id:"openai-codex",name:"ChatGPT · SYNTHETIC",configured:false,oauth:{name:"ChatGPT",loginLabel:"Sign in with ChatGPT",isSubscription:true}}]};break;
 case "credentials.list":data={credentials:[]};break;
 case "credentials.logins":data={logins:[]};break;
 case "subscriptions.usage":if(q.refresh)refreshes++;data={subscriptions:[subscription("anthropic","Claude",78),subscription("openai-codex","ChatGPT",36)]};console.log(JSON.stringify({type:q.type,refresh:q.refresh??false,refreshes}));break;
 default:ws.send(JSON.stringify({type:"error",id:q.id,error:{code:"unsupported",message:"Read-only SYNTHETIC appearance source; no provider login or write."}}));return;
 }
 const response={type:q.type,id:q.id,...data};if(!Value.Check(ServerMessageSchema,response))throw Error(JSON.stringify([...Value.Errors(ServerMessageSchema,response)]));ws.send(JSON.stringify(response));
}}});
console.log("SYNTHETIC usage/account appearance on loopback"+port+"; no real account or external provider");
