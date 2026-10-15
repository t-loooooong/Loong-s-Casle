import { initialize } from "./dataset.mjs";
const history = await initialize();
console.log(`Initialized ${history.records.length} historical observations.`);
