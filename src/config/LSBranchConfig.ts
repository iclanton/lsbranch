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
  repos: ILSBranchConfigRepo[];
}

export class LSBranchConfig {
  private _configPath: string;
  private _schema: JsonSchema;
  private _configLoaded: boolean = false;
  private _configExists!: boolean;
  private _configData!: ILSBranchConfig;

  public constructor(configPath: string = LSBranchConfig.getDefaultConfigPath()) {
    this._configPath = configPath;

    this._schema = JsonSchema.fromFile(path.join(__dirname, 'lsbranchrc.schema.json'));
  }

  public static getDefaultConfigPath(): string {
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

    return this._validateNoDuplicateProperties(this._configData.repos, ['alias', 'path'], terminal);
  }

  public async getConfigReposAsync(): Promise<ILSBranchConfigRepo[]> {
    await this._ensureConfigLoadedAsync();
    return this._configData.repos;
  }

  private async _ensureConfigLoadedAsync(): Promise<void> {
    if (!this._configLoaded) {
      try {
        this._configData = await JsonFile.loadAndValidateAsync(this._configPath, this._schema);
        this._configExists = true;
      } catch (e) {
        if (FileSystem.isNotExistError(e)) {
          this._configExists = false;
        } else {
          throw e;
        }
      } finally {
        this._configLoaded = true;
      }
    }
  }

  private _validateNoDuplicateProperties(
    data: ILSBranchConfigRepo[],
    propNames: (keyof ILSBranchConfigRepo)[],
    terminal: Terminal
  ): boolean {
    let issues: boolean = false;

    const propNameCounters: Map<keyof ILSBranchConfigRepo, Map<unknown, number>> = new Map<
      keyof ILSBranchConfigRepo,
      Map<unknown, number>
    >();
    for (const element of data) {
      for (const propName of propNames) {
        const propValue: unknown | undefined = element[propName];
        if (propValue !== undefined) {
          let counter: Map<unknown, number> | undefined = propNameCounters.get(propName);
          if (!counter) {
            counter = new Map<unknown, number>();
            propNameCounters.set(propName, counter);
          }

          const count: number = counter.get(propValue) || 0;
          if (count === 1) {
            terminal.writeErrorLine(`Repo ${propName} "${propValue}" is specified multiple times.`);
            issues = true;
          }

          counter.set(propValue, count + 1);
        }
      }
    }

    return !issues;
  }
}
