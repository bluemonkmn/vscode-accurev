import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import { AccuRevFile } from './file';
import { AccuRevState } from './state';
import * as path from 'path';

export enum AccuRevVersion {
	Basis,
	Kept
}

export class AccuRevRepo {
    outChannel: vscode.OutputChannel;
    workspaceRoot: string;
    workspaceName: string;
    basisName: string;
    disposables: Map<string, vscode.Disposable> = new Map<string, vscode.Disposable>();
    config: vscode.WorkspaceConfiguration;

    private constructor(out: vscode.OutputChannel, workspaceRoot: string, config: vscode.WorkspaceConfiguration) {
        this.outChannel = out;
        this.workspaceRoot = workspaceRoot;
        this.workspaceName = "";
        this.basisName = "";
        this.config = config;
    }

	public static async GetInstance(out: vscode.OutputChannel, workspaceRoot: string, config: vscode.WorkspaceConfiguration): Promise<AccuRevRepo> {
		let repo = new AccuRevRepo(out, workspaceRoot, config);
		await repo.getInfo();
		return repo;
	}

    public async execute(command: string): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
			let accurev = "accurev";
			if (this.config.path !== null) {
				accurev = `\"${this.config.path}\"`;
			}
            cp.exec(`cd \"${this.workspaceRoot}\" & ${accurev} ${command}`, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                let result: string = stdout;
                if (stderr) {
                    result += stderr;
                }
                resolve(result);
            });
        });
    }

    public getPending() {
        this.execute("stat -p -fx").then((result) => {
            this.outChannel.appendLine(result);
        }, (reject) => {
            this.outChannel.appendLine(reject);
        });
    }

    public async getInfo() {
		let result = await this.execute("info");
		try {
            const reWS = /^(Workspace\/ref|Basis):\s+(\S+)\s*$/gm;
            let match: RegExpExecArray | null;
            while ((match = reWS.exec(result)) !== null) {
                if (match[1] === "Workspace/ref") {
                    this.workspaceName = match[2];
                } else if (match[1] === "Basis") {
                    this.basisName = match[2];
                }
            }
        } catch(err) {
            this.outChannel.appendLine(err);
        }
    }

    public async provideOriginalResource(uri: vscode.Uri, token?: vscode.CancellationToken, version?: AccuRevVersion): Promise<vscode.Uri | null> {
		if (!this.basisName || !this.workspaceName) {
			this.outChannel.appendLine(`Attempted to get original version of ${uri.fsPath} before initialization completed.`);
			return null;
		}
        await this.makeTempParentExist();
        let tempDir = this.getTempDir(version);
        let tempExists = await new Promise<boolean>((resolve) => {
            fs.access(tempDir, (err) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
        if (!tempExists) {
            let mkdir = promisify(fs.mkdir);            
            await mkdir(tempDir, {recursive: true});
		}
		
		let relativePath = vscode.workspace.asRelativePath(uri.fsPath);
		const tempFullPath = path.join(tempDir,relativePath);
		try {
			if (version === AccuRevVersion.Kept) {
				await this.execute(`pop -O -v ${this.workspaceName} -L ${tempDir} \"\\.\\${relativePath}\"`);
			} else {
				await this.execute(`pop -O -v ${this.basisName} -L ${tempDir} \"\\.\\${relativePath}\"`);
			}
		}
		catch(err) {
			this.outChannel.appendLine(`Error retrieving original file: ${err}`);
			return null;
		}
		if (!this.disposables.has(tempDir + relativePath)) {
			this.disposables.set(tempDir + relativePath, {dispose: async () => {
				let unlink = promisify(fs.unlink);
				let rmdir = promisify(fs.rmdir);
				let readdir = promisify(fs.readdir);
				try {
					try {
						this.outChannel.appendLine(`Cleaning up ${tempFullPath}...`);
					} catch(err2) { }
					await unlink(tempFullPath);
					relativePath = path.dirname(relativePath);
					while (/[^\\\.]+/.test(relativePath)) {
						let parent = path.join(tempDir,relativePath);
						if ((await readdir(parent)).length === 0) {
							await rmdir(parent);
						}
						relativePath = path.dirname(relativePath);
					}
				} catch (err) {
					try {
						this.outChannel.appendLine(`Failed - ${err}.`);
					} catch(err3) { }
				}
				return;
			}});
		}
		return vscode.Uri.file(tempFullPath);
    }

    public async getResourceStates(): Promise<AccuRevFile[]> {
        let resList: string;
        try {
            resList = await this.execute("stat -p -fx");
        }
        catch (err) {
            this.outChannel.appendLine(`Error retrieving pending file information: ${err}`);
            if (/session token/.test(err)) {
                if (!this.config.userid) {
                    this.outChannel.appendLine("AccuRev User ID setting is not specified. To allow automatic login, enter this setting.");
                    return [];
                }
                this.outChannel.appendLine("Attempting to login to resolve the problem...");
                try {
                   await this.execute(`login ${this.config.userid} ""`);
                   resList = await this.execute("stat -p -fx");
                } catch (err2) {
                    this.outChannel.appendLine(`Failed to login: ${err2}`);
                    return [];
                }
            } else {
                this.outChannel.appendLine("Cause of error does not appear login related, giving up.");
                return [];
            }
        }
        let match: RegExpExecArray | null;
        let result: AccuRevFile[] = [];
        let resourcePattern = /<element[^>]+\s+location=\"([^"\n]+)\"[^>]+\s+id=\"(\d+)\"[^>]+\s+status=\"([^"\n]+)\"/gm;
        while ((match = resourcePattern.exec(resList)) !== null) {
			let state: AccuRevState = AccuRevState.kept;
			if (match[3].indexOf("(overlap)") >= 0) {
				state = AccuRevState.overlap;
			} else if (match[3].indexOf("(modified)") >= 0) {
				if (match[3].indexOf("(kept)") >= 0) {
					state = AccuRevState.keptmodified;
				} else {
					state = AccuRevState.modified;
				}
            }
            let filePath = path.join(this.workspaceRoot, match[1].substr(2));
            result.push(new AccuRevFile(vscode.Uri.file(filePath), Number.parseInt(match[2]), state));
        }
        return result;
    }

    public async dispose(): Promise<any> {
		for(const [, disposable] of this.disposables) {
			await disposable.dispose();
		}
		this.disposables.clear();
		let rmdir = promisify(fs.rmdir);
		let tempDir = this.getTempDir(AccuRevVersion.Kept);
		try {
			await rmdir(tempDir);
			tempDir = this.getTempDir();
			await rmdir(tempDir);
		} catch (err) {
			try {
				this.outChannel.appendLine(`Error deleting ${tempDir}: ${err}.`);
			} catch (err2) { }
		}
    }

    private getTempDir(version?: AccuRevVersion): string {
        let tempDir = process.env["TEMP"];
        if (tempDir === undefined) {
            throw new Error("Unable to identify Temp directory.");
		}
		if (version === AccuRevVersion.Kept) {
			return path.join(tempDir, 'vscode-accurev', 'k-' + vscode.env.sessionId);
		} else {
			return path.join(tempDir, 'vscode-accurev', vscode.env.sessionId);
		}
    }

    private async makeTempParentExist() {
        let temp = process.env["TEMP"];
        if (temp === undefined) {
            throw new Error("Unable to identify Temp directory.");
        }
        let tempParent = path.join(temp, 'vscode-accurev');
        let tempExists = await new Promise<boolean>((resolve) => {
            fs.access(tempParent, (err) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
        if (!tempExists) {
            let mkdir = promisify(fs.mkdir);
            try {
                await mkdir(tempParent);
            } catch (err) {
                this.outChannel.appendLine(`Failed to create ${tempParent}: ${err}`);
            }
        }
    }
}
