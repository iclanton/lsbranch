// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import os from 'node:os';
import path from 'node:path';
import { default as semver, SemVer } from 'semver';
import { IPackageJson, JsonFile } from '@rushstack/node-core-library';
import { Terminal } from '@rushstack/terminal';

import { LSBranchConfig } from '../config/LSBranchConfig';
import { LSBRANCH_TOOL_FILENAME } from '../cli/LSBranchCommandLineParser';

interface INpmQueryResponse {
  'dist-tags'?: {
    latest: 'string';
  };
  versions: { [version: string]: unknown };
}

const TIMEOUT_MS: number = 1000; // One second

export class UpgradeMessagePrinter {
  private readonly _printUpgradeMessageAsyncFunction: (terminal: Terminal) => Promise<void>;

  private constructor(printUpgradeMessageAsyncFunction: (terminal: Terminal) => Promise<void>) {
    this._printUpgradeMessageAsyncFunction = printUpgradeMessageAsyncFunction;
  }

  public static async initializeAsync(config: LSBranchConfig): Promise<UpgradeMessagePrinter> {
    let printUpgradeMessageAsyncFunction: (terminal: Terminal) => Promise<void> = async (
      terminal: Terminal
    ) => {
      /* no-op, by default */
    };

    const shouldCheckForUpdates: boolean = await config.getShouldCheckForUpdatesAsync();
    if (shouldCheckForUpdates) {
      const packageJson: IPackageJson = await JsonFile.loadAsync(
        path.resolve(__dirname, '..', '..', 'package.json')
      );

      const latestVersion: SemVer | undefined = await UpgradeMessagePrinter._getLatestPublishedVersionAsync(
        packageJson
      );
      if (latestVersion !== undefined) {
        printUpgradeMessageAsyncFunction = async (terminal: Terminal) => {
          await config.setLastUpdateCheckAsync();

          const currentVersion: SemVer = new SemVer(packageJson.version);
          if (semver.gt(latestVersion, currentVersion)) {
            const latestVersionString: string = latestVersion.format();
            terminal.writeLine();
            terminal.writeLine(
              `An update to ${LSBRANCH_TOOL_FILENAME} is available. The latest version is ${latestVersionString} ` +
                `Run "npm install -g ${packageJson.name}@${latestVersionString}" to update`
            );
          }
        };
      }
    }

    return new UpgradeMessagePrinter(printUpgradeMessageAsyncFunction);
  }

  private static async _getLatestPublishedVersionAsync(
    thisPackageJson: IPackageJson
  ): Promise<SemVer | undefined> {
    try {
      const queryUrl: string = `https://registry.npmjs.org/${thisPackageJson.name}`;
      const userAgent: string = `npm/? node/${process.version} ${os.platform()} ${os.arch()}`;
      const headers: Headers = new Headers({
        'User-Agent': userAgent,
        Accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'
      });

      const response: Response = await fetch(queryUrl, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const responseJson: INpmQueryResponse = (await response.json()) as INpmQueryResponse;
      let latestVersion: SemVer | null;
      if (responseJson['dist-tags'] && responseJson['dist-tags'].latest) {
        latestVersion = new SemVer(responseJson['dist-tags'].latest);
      } else {
        const allVersions: string[] = Object.keys(responseJson.versions);
        latestVersion = new SemVer('0.0.0')!;
        for (const version of allVersions) {
          const parsedVersion: SemVer | null = semver.parse(version);
          if (parsedVersion && semver.gt(parsedVersion, latestVersion)) {
            latestVersion = parsedVersion;
          }
        }
      }

      return latestVersion || undefined;
    } catch (e) {
      return undefined;
    }
  }

  public async printUpgradeMessageAsync(terminal: Terminal): Promise<void> {
    await this._printUpgradeMessageAsyncFunction(terminal);
  }
}
