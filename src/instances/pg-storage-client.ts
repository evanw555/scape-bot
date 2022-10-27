import PGStorageClient from '../pg-storage-client';

import { AUTH } from '../constants';

// Export global PG storage client singleton
const pgStorage: PGStorageClient = new PGStorageClient(AUTH.pg);
export default pgStorage;
