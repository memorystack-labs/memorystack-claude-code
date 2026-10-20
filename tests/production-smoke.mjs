import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
const client = new Client({name:'claude-plugin-production-smoke',version:'1'});
const transport = new StdioClientTransport({command:process.execPath,args:[path.resolve('plugin/scripts/memory-server.mjs')],env:{...process.env},stderr:'pipe'});
try {
 await client.connect(transport);
 const tools=await client.listTools();
 const call=async(name,args)=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(r.content.find(x=>x.type==='text')?.text);return JSON.parse(r.content.find(x=>x.type==='text').text);};
 const scope=await call('memory_resolve_scope',{cwd:process.cwd()});
 const recall=await call('memory_retrieve_task_context',{cwd:process.cwd(),target:'claude-code',task:{goal:'Claude Code plugin lifecycle integration and memory scope testing'},limit:3,max_context_chars:4000});
 console.log(JSON.stringify({toolCount:tools.tools.length,requiredTools:['memory_read_source','memory_write','memory_validate_context','memory_checkpoint','memory_retrieve_task_context'].every(n=>tools.tools.some(t=>t.name===n)),scope:scope.write_scope,recall:{mode:recall.mode,count:recall.count,budget:recall.budget,incomplete:recall.incomplete,unavailable:recall.unavailable}}));
} finally {await client.close();}
