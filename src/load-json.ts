import FileStorage from "./file-storage.js";

const rootStorage = new FileStorage('./');

export function loadJson(path: string): any {
    return rootStorage.readJsonSync(path);
};
