import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import { AccuRevFile } from './file';
import { AccuRevState } from './state';
import * as path from 'path';
import { stringify } from 'querystring';

export enum AccuRevVersion {
	Basis,
	Kept
}

export class AccuRevRepo {
    outChannel: vscode.OutputChannel;
    workspaces: Map<string, {workspace: string, basis: string}>;
	disposables: Map<string, vscode.Disposable> = new Map<string, vscode.Disposable>();
    config: vscode.WorkspaceConfiguration;

    private constructor(out: vscode.OutputChannel, workspaces: Map<string, {workspace: string, basis: string}>, config: vscode.WorkspaceConfiguration) {
        this.outChannel = out;
        this.workspaces = workspaces;
        this.config = config;
    }

	public static async GetInstance(out: vscode.OutputChannel, roots: string[], config: vscode.WorkspaceConfiguration): Promise<AccuRevRepo> {
		let workspaceInfo = await Promise.all(roots.map(root => {return AccuRevRepo.getInfo(out, config, root);}));
		let wsMap: Map<string, {workspace: string, basis: string}> = new Map<string, {workspace: string, basis: string}>();
		for (let ws of workspaceInfo) {
			if (ws.basis && !wsMap.has(ws.root)) {
				wsMap.set(ws.root, {workspace: ws.workspace, basis: ws.basis});
			}
		}
		return new AccuRevRepo(out, wsMap, config);
	}

	public static async execute(out: vscode.OutputChannel, config: vscode.WorkspaceConfiguration, folder: string, command: string, giveUpOnError: boolean): Promise<string> {
        return new Promise<string>(async (resolve, reject) => {
			let accurev = "accurev";
			if (config.path !== null) {
				accurev = `\"${config.path}\"`;
			}
			out.appendLine(command);
            cp.exec(`cd \"${folder}\" & ${accurev} ${command}`, (err, stdout, stderr) => {
                if (err) {
					if (!giveUpOnError && /session token/.test(err.message)) {
						out.appendLine(`Error attempting ${command}. Attempting login to resolve.`);
						AccuRevRepo.execute(out, config, folder, `login ${config.userid} ""`, true).then(value => {
							out.appendLine(`Login resolved problem: ${value}`);
							AccuRevRepo.execute(out, config, folder, command, true).then(value => {
								resolve(value);
							}, reason => {
								reject(reason);
							});
						}, reason => {
							out.appendLine(`Login failed to resolve problem: ${reason}`);
							reject(reason);
						});
					} else {
						reject(err);
					}
                    return;
                }
                let result: string = stdout;
                if (stderr) {
                    result += stderr;
				}
				if (result.length < 256) {
					out.appendLine(result);
				}
                resolve(result);
            });
        });
	}

    public execute(root: string, command: string): Promise<string> {
		return AccuRevRepo.execute(this.outChannel, this.config, root, command, false);
    }

	public static async getInfo(outChannel: vscode.OutputChannel, config: vscode.WorkspaceConfiguration, folder: string): Promise<{root: string, workspace: string, basis: string}> {
		let out = await AccuRevRepo.execute(outChannel, config, folder, "info", false);
		let result = {root: "", workspace: "", basis: ""};
		try {
			outChannel.appendLine(out);
			result = this.parseInfo(out);
			if (!result.workspace) {
				outChannel.appendLine("Attempting login to retrieve complete workspace info.");
				await AccuRevRepo.execute(outChannel, config, folder, `login ${config.userid} ""`, true);
				out = await AccuRevRepo.execute(outChannel, config, folder, "info", false);
				outChannel.appendLine(out);
				result = this.parseInfo(out);
			}
			outChannel.appendLine(`Root: "${result.root}", Workspace: "${result.workspace}", Basis: "${result.basis}"`);
        } catch(err) {
            outChannel.appendLine(err);
		}
		return result;
	}

	private static parseInfo(out: string): {root: string, workspace: string, basis: string} {
		const reWS = /^(Workspace\/ref|Basis|Top):\s+([^\n\r]+)\s*$/gm;
		let match: RegExpExecArray | null;
		let result = {root: "", workspace: "", basis: ""};
		while ((match = reWS.exec(out)) !== null) {
			if (match[1] === "Workspace/ref") {
				result.workspace = match[2];
			} else if (match[1] === "Basis") {
				result.basis = match[2];
			} else if (match[1] === "Top") {
				result.root = match[2].toLowerCase();
			}
		}
		return result;
	}

    public async provideOriginalResource(uri: vscode.Uri, token?: vscode.CancellationToken, version?: AccuRevVersion): Promise<vscode.Uri | null> {
		let wsInfo = this.GetWorkspaceInfo(uri);
		if (wsInfo === undefined) {
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
		
		let relativePath = path.relative(wsInfo.root, uri.fsPath);
		const tempFullPath = path.join(tempDir,relativePath);
		try {
			if (version === AccuRevVersion.Kept) {
				await this.execute(wsInfo.root, `pop -O -v ${wsInfo.workspace} -L ${tempDir} \"\\.\\${relativePath}\"`);
			} else {
				await this.execute(wsInfo.root, `pop -O -v ${wsInfo.basis} -L ${tempDir} \"\\.\\${relativePath}\"`);
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
        let resLists: {root: string, resOutput: string}[] = [];
		let result: AccuRevFile[] = [];
        try {
			let stats: Promise<{root: string, resOutput: string}>[]= [];
			for(let [wsRoot,] of this.workspaces) {
				stats.push(this.execute(wsRoot, "stat -p -fx").then(value => {
					return {root: wsRoot, resOutput: value};
				}));
			}
            resLists = await Promise.all(stats);

			let match: RegExpExecArray | null;
			let resourcePattern = /<element[^>]+\s+location=\"([^"\n]+)\"[^>]+\s+id=\"(\d+)\"[^>]+\s+status=\"([^"\n]+)\"/gm;
			for (let resList of resLists) {
				while ((match = resourcePattern.exec(resList.resOutput)) !== null) {
					let state: AccuRevState = AccuRevState.kept;
					if (match[3].indexOf("(modified)") >= 0) {
						if (match[3].indexOf("(kept)") >= 0) {
							state = AccuRevState.keptmodified;
						} else {
							state = AccuRevState.modified;
						}
					}
					if (match[3].indexOf("(overlap)")>=0) {
						if (state === AccuRevState.modified) {
							state = AccuRevState.overlapmodified;
						} else {
							state = AccuRevState.overlapkept;
						}
					}
					let filePath = path.join(resList.root, match[1].substr(2));
					result.push(new AccuRevFile(vscode.Uri.file(filePath), Number.parseInt(match[2]), state));
				}
			}
		}
        catch (err) {
			this.outChannel.appendLine(`Error getting resource states: ${err}`);
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
	
	public GetWorkspaceInfo(uri: vscode.Uri): {root: string; workspace: string; basis: string} | undefined {
		for(let [wsRoot,] of this.workspaces) {
			if (uri.fsPath.startsWith(wsRoot)) {
				let ws = this.workspaces.get(wsRoot);
				if (ws === undefined) {
					return undefined;
				}
				return {root: wsRoot, workspace: ws.workspace, basis: ws.basis};
			}
		}
	}
}
