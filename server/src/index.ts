import 'dotenv/config';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const port = Number(process.env.PORT) || 3000;

const app = createApp(loadConfig());

app.listen(port, () => {
  console.log(`NEXO API disponível na porta ${port}`);
});
