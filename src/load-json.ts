import FileStorage from "./file-storage";

const rootStorage = new FileStorage('./');

export function loadJson(path: string): any {
    return rootStorage.readJsonSync(path);
};
