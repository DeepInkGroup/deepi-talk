import {createRenderServer} from './render-server.mjs';
const origin=process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL;
const directory=process.env.DATA_DIR;
if(!origin||!directory)throw new Error('Set APP_ORIGIN (or use Render RENDER_EXTERNAL_URL) and DATA_DIR before starting.');
const {server}=await createRenderServer({origin:origin.replace(/\/$/,''),directory});
const port=Number(process.env.PORT||3000);
server.listen(port,'0.0.0.0',()=>console.log(`Deepi Talk is listening on port ${port}.`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
