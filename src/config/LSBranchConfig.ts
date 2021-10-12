// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { FileSystem, JsonFile, JsonSchema, Terminal } from '@rushstack/node-core-library';
import path from 'path';

const LSBRANCH_CONFIG_FILENAME: string = '.lsbranchrc.json';

export interface ILSBranchConfigRepo {
  path: string;
  alias?: string;
}

export interface ILSBranchConfig {
  lastUpdateCheck?: number;
  repos: ILSBranchConfigRepo[];
}

const UNIQUE_PROP_NAMES: (keyof ILSBranchConfigRepo)[] = ['alias', 'path'];

const UPDATE_CHECK_FREQUENCY: number = 24 * 60 * 60 * 1000; // Daily

export class LSBranchConfig {
  private _configPath: string | undefined;
  private _isDefaultConfigPath: boolean | undefined;

  public get configPath(): string {
    if (this._configPath === undefined) {
      this._configPath = path.resolve(this._getConfigPath() || LSBranchConfig._getDefaultConfigPath());
    }

    return this._configPath;
  }

  public get isDefaultConfigPath(): boolean {
    if (this._isDefaultConfigPath === undefined) {
      this._isDefaultConfigPath = this.configPath === LSBranchConfig._getDefaultConfigPath();
    }

    return this._isDefaultConfigPath;
  }

  private readonly _getConfigPath: () => string | undefined;
  private readonly _schema: JsonSchema;

  private _configLoaded: boolean = false;
  private _configExists!: boolean;
  private _configData!: ILSBranchConfig;
  private _propNameCounters!: {
    [TPropName in Required<keyof ILSBranchConfigRepo>]: Map<ILSBranchConfigRepo[TPropName], number>;
  };

  public constructor(getConfigPath: () => string | undefined) {
    this._getConfigPath = getConfigPath;

    this._schema = JsonSchema.fromFile(path.join(__dirname, 'lsbranchrc.schema.json'));
  }

  private static _getDefaultConfigPath(): string {
    const homeFolderPath: string | undefined =
      process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
    if (!homeFolderPath) {
      throw new Error('Unable to determine user home folder path.');
    }

    return path.join(homeFolderPath, LSBRANCH_CONFIG_FILENAME);
  }

  public async getConfigExistsAsync(): Promise<boolean> {
    await this._ensureConfigLoadedAsync();
    return this._configExists;
  }

  public async validateAsync(terminal: Terminal): Promise<boolean> {
    await this._ensureConfigLoadedAsync();
    return this._validateNoDuplicateProperties(UNIQUE_PROP_NAMES, terminal);
  }

  public async getConfigReposAsync(): Promise<ILSBranchConfigRepo[]> {
    await this._ensureConfigLoadedAsync();
    return this._configData.repos;
  }

  public async getShouldCheckForUpdatesAsync(): Promise<boolean> {
    await this._ensureConfigLoadedAsync();
    const nextUpdateTime: number = (this._configData.lastUpdateCheck || 0) + UPDATE_CHECK_FREQUENCY;
    const now: number = Date.now();
    return nextUpdateTime < now;
  }

  public async setLastUpdateCheckAsync(): Promise<void> {
    const newConfigData: ILSBranchConfig = {
      ...this._configData,
      lastUpdateCheck: Date.now()
    };
    await this._updateConfigDataAsync(newConfigData);
  }

  public async tryAddRepoAsync(repo: ILSBranchConfigRepo, terminal: Terminal): Promise<boolean> {
    await this._ensureConfigLoadedAsync();

    let issues: boolean = false;

    for (const propName of UNIQUE_PROP_NAMES) {
      const propValue: unknown | undefined = repo[propName];
      if (propValue !== undefined) {
        const counter: Map<unknown, number> = this._propNameCounters[propName];
        const count: number = counter.get(propValue) || 0;
        if (count > 0) {
          terminal.writeErrorLine(`Repo ${propName} "${propValue}" already exists`);
          issues = true;
        }
      } else {
        delete repo[propName];
      }
    }

    if (issues) {
      return false;
    } else {
      const newConfigData: ILSBranchConfig = {
        ...this._configData,
        repos: [...this._configData.repos, repo]
      };
      await this._updateConfigDataAsync(newConfigData);

      return true;
    }
  }

  private async _ensureConfigLoadedAsync(): Promise<void> {
    if (!this._configLoaded) {
      let errorThrown: boolean = false;
      try {
        this._configData = await JsonFile.loadAndValidateAsync(this.configPath, this._schema);
        this._configExists = true;
      } catch (e) {
        if (FileSystem.isNotExistError(e as NodeJS.ErrnoException)) {
          this._configData = {
            lastUpdateCheck: Date.now(),
            repos: []
          };
          this._configExists = false;
        } else {
          errorThrown = true;
          throw e;
        }
      } finally {
        if (!errorThrown) {
          this._fillPropNameCounters();
          this._configLoaded = true;
        }
      }
    }
  }

  private async _updateConfigDataAsync(newConfigData: ILSBranchConfig): Promise<void> {
    await JsonFile.saveAsync(newConfigData, this.configPath, {
      updateExistingFile: true,
      prettyFormatting: true
    });
    this._configExists = true;

    // Only update data if we're able to successfully save the file
    this._configData = newConfigData;
    this._fillPropNameCounters();
  }

  private _fillPropNameCounters(): void {
    this._propNameCounters = {
      path: new Map<string, number>(),
      alias: new Map<string, number>()
    };

    for (const repo of this._configData.repos) {
      for (const propName of UNIQUE_PROP_NAMES) {
        const propValue: unknown | undefined = repo[propName];
        if (propValue !== undefined) {
          const counter: Map<unknown, number> = this._propNameCounters[propName];
          const count: number = counter.get(propValue) || 0;
          counter.set(propValue, count + 1);
        }
      }
    }
  }

  private _validateNoDuplicateProperties(
    propNames: (keyof ILSBranchConfigRepo)[],
    terminal: Terminal
  ): boolean {
    let issues: boolean = false;

    for (const propName of propNames) {
      const counter: Map<unknown, number> = this._propNameCounters[propName];
      for (const [propValue, count] of counter.entries()) {
        if (count > 1) {
          terminal.writeErrorLine(`Repo ${propName} "${propValue}" is specified multiple times.`);
          issues = true;
        }
      }
    }

    return !issues;
  }
}
