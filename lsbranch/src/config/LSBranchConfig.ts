// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { FileSystem, JsonFile, JsonSchema } from '@rushstack/node-core-library';
import { Terminal } from '@rushstack/terminal';

import schema from './lsbranchrc.schema.json';
import type { LSBranchConfigurationSchema } from './lsbranchrc.schema.json.d.ts';

export const LSBRANCH_CONFIG_FILENAME: string = '.lsbranchrc.json';

export type LSBranchConfigurationSchemaRepo = LSBranchConfigurationSchema['repos'][number];

const UNIQUE_PROP_NAMES: (keyof LSBranchConfigurationSchemaRepo)[] = ['alias', 'path'];

const UPDATE_CHECK_FREQUENCY: number = 24 * 60 * 60 * 1000; // Daily

export class LSBranchConfig {
  #configPath: string | undefined;
  #isDefaultConfigPath: boolean | undefined;

  public get configPath(): string {
    if (this.#configPath === undefined) {
      this.#configPath = path.resolve(this.#getConfigPath() || LSBranchConfig.#getDefaultConfigPath());
    }

    return this.#configPath;
  }

  public get isDefaultConfigPath(): boolean {
    if (this.#isDefaultConfigPath === undefined) {
      this.#isDefaultConfigPath = this.configPath === LSBranchConfig.#getDefaultConfigPath();
    }

    return this.#isDefaultConfigPath;
  }

  readonly #getConfigPath: () => string | undefined;
  readonly #schema: JsonSchema;

  #configLoaded: boolean = false;
  #configExists!: boolean;
  #configData!: LSBranchConfigurationSchema;
  #propNameCounters!: {
    [TPropName in Required<keyof LSBranchConfigurationSchemaRepo>]: Map<
      LSBranchConfigurationSchemaRepo[TPropName],
      number
    >;
  };

  public constructor(getConfigPath: () => string | undefined) {
    this.#getConfigPath = getConfigPath;

    this.#schema = JsonSchema.fromLoadedObject(schema);
  }

  static #getDefaultConfigPath(): string {
    const homeFolderPath: string | undefined =
      process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
    if (!homeFolderPath) {
      throw new Error('Unable to determine user home folder path.');
    }

    return `${homeFolderPath}/${LSBRANCH_CONFIG_FILENAME}`;
  }

  public async getConfigExistsAsync(): Promise<boolean> {
    await this.#ensureConfigLoadedAsync();
    return this.#configExists;
  }

  public async validateAsync(terminal: Terminal): Promise<boolean> {
    await this.#ensureConfigLoadedAsync();
    return this.#validateNoDuplicateProperties(UNIQUE_PROP_NAMES, terminal);
  }

  public async getConfigReposAsync(): Promise<LSBranchConfigurationSchemaRepo[]> {
    await this.#ensureConfigLoadedAsync();
    return this.#configData.repos;
  }

  public async getShouldCheckForUpdatesAsync(): Promise<boolean> {
    await this.#ensureConfigLoadedAsync();
    const nextUpdateTime: number = (this.#configData.lastUpdateCheck || 0) + UPDATE_CHECK_FREQUENCY;
    const now: number = Date.now();
    return nextUpdateTime < now;
  }

  public async setLastUpdateCheckAsync(): Promise<void> {
    const newConfigData: LSBranchConfigurationSchema = {
      ...this.#configData,
      lastUpdateCheck: Date.now()
    };
    await this.#updateConfigDataAsync(newConfigData);
  }

  public async tryAddRepoAsync(repo: LSBranchConfigurationSchemaRepo, terminal: Terminal): Promise<boolean> {
    await this.#ensureConfigLoadedAsync();

    let issues: boolean = false;

    for (const propName of UNIQUE_PROP_NAMES) {
      const propValue: unknown | undefined = repo[propName];
      if (propValue !== undefined) {
        const counter: Map<unknown, number> = this.#propNameCounters[propName];
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
      const newConfigData: LSBranchConfigurationSchema = {
        ...this.#configData,
        repos: [...this.#configData.repos, repo]
      };
      await this.#updateConfigDataAsync(newConfigData);

      return true;
    }
  }

  async #ensureConfigLoadedAsync(): Promise<void> {
    if (!this.#configLoaded) {
      let errorThrown: boolean = false;
      try {
        this.#configData = await JsonFile.loadAndValidateAsync(this.configPath, this.#schema);
        this.#configExists = true;
      } catch (e) {
        if (FileSystem.isNotExistError(e as NodeJS.ErrnoException)) {
          this.#configData = {
            lastUpdateCheck: Date.now(),
            repos: []
          };
          this.#configExists = false;
        } else {
          errorThrown = true;
          throw e;
        }
      } finally {
        if (!errorThrown) {
          this.#fillPropNameCounters();
          this.#configLoaded = true;
        }
      }
    }
  }

  async #updateConfigDataAsync(newConfigData: LSBranchConfigurationSchema): Promise<void> {
    await JsonFile.saveAsync(newConfigData, this.configPath, {
      updateExistingFile: true,
      prettyFormatting: true
    });
    this.#configExists = true;

    // Only update data if we're able to successfully save the file
    this.#configData = newConfigData;
    this.#fillPropNameCounters();
  }

  #fillPropNameCounters(): void {
    this.#propNameCounters = {
      path: new Map<string, number>(),
      alias: new Map<string, number>()
    };

    for (const repo of this.#configData.repos) {
      for (const propName of UNIQUE_PROP_NAMES) {
        const propValue: unknown | undefined = repo[propName];
        if (propValue !== undefined) {
          const counter: Map<unknown, number> = this.#propNameCounters[propName];
          const count: number = counter.get(propValue) || 0;
          counter.set(propValue, count + 1);
        }
      }
    }
  }

  #validateNoDuplicateProperties(
    propNames: (keyof LSBranchConfigurationSchemaRepo)[],
    terminal: Terminal
  ): boolean {
    let issues: boolean = false;

    for (const propName of propNames) {
      const counter: Map<unknown, number> = this.#propNameCounters[propName];
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
