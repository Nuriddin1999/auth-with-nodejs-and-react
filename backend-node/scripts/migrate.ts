/** Create the database tables if they don't exist yet (the server also does this on start). */

import { settings } from '../src/config.ts';
import { closeDatabase, openDatabase } from '../src/db.ts';

openDatabase();
closeDatabase();
console.log(`Database ready: ${settings.DATABASE_PATH}`);
