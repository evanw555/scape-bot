import FileStorage from './file-storage';
import { AnyObject } from './types';

const rootStorage = new FileStorage('./');

export function loadJson(path: string): AnyObject {
    return rootStorage.readJsonSync(path);
}
