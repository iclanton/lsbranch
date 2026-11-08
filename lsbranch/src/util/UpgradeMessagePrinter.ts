// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import os from 'node:os';
import { default as semver, SemVer } from 'semver';
import { IPackageJson } from '@rushstack/node-core-library';
import { Terminal } from '@rushstack/terminal';

import { LSBranchConfig } from '../config/LSBranchConfig';
import { LSBRANCH_TOOL_FILENAME } from '../cli/LSBranchCommandLineParser';
import packageJson from '../../package.json';

interface INpmQueryResponse {
  'dist-tags'?: {
    latest: string;
  };
  versions: { [version: string]: unknown };
}

const TIMEOUT_MS: number = 1000; // One second

async function getLatestPublishedVersionAsync(thisPackageJson: IPackageJson): Promise<SemVer | undefined> {
  const { name } = thisPackageJson;
  try {
    const queryUrl: string = `https://registry.npmjs.org/${name}`;
    const userAgent: string = `npm/? node/${process.version} ${os.platform()} ${os.arch()}`;
    const headers: Headers = new Headers({
      'User-Agent': userAgent,
      Accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*'
    });

    const response: Response = await fetch(queryUrl, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const responseJson: INpmQueryResponse = (await response.json()) as INpmQueryResponse;
    const { 'dist-tags': distTags, versions } = responseJson;
    const latest: string | undefined = distTags?.latest;
    let latestVersion: SemVer;
    if (latest) {
      latestVersion = new SemVer(latest);
    } else {
      const allVersions: string[] = Object.keys(versions);
      latestVersion = new SemVer('0.0.0');
      for (const version of allVersions) {
        const parsedVersion: SemVer | null = semver.parse(version);
        if (parsedVersion && semver.gt(parsedVersion, latestVersion)) {
          latestVersion = parsedVersion;
        }
      }
    }

    return latestVersion;
  } catch (e) {
    return undefined;
  }
}

export class UpgradeMessagePrinter {
  readonly #printUpgradeMessageAsyncFunction: (terminal: Terminal) => Promise<void>;

  private constructor(printUpgradeMessageAsyncFunction: (terminal: Terminal) => Promise<void>) {
    this.#printUpgradeMessageAsyncFunction = printUpgradeMessageAsyncFunction;
  }

  public static async initializeAsync(config: LSBranchConfig): Promise<UpgradeMessagePrinter> {
    let printUpgradeMessageAsyncFunction: (terminal: Terminal) => Promise<void> = async (
      terminal: Terminal
    ) => {
      /* no-op, by default */
    };

    const shouldCheckForUpdates: boolean = await config.getShouldCheckForUpdatesAsync();
    if (shouldCheckForUpdates) {
      const { name, version } = packageJson;
      const latestVersion: SemVer | undefined = await getLatestPublishedVersionAsync(packageJson);
      if (latestVersion !== undefined) {
        printUpgradeMessageAsyncFunction = async (terminal: Terminal) => {
          await config.setLastUpdateCheckAsync();

          const currentVersion: SemVer = new SemVer(version);
          if (semver.gt(latestVersion, currentVersion)) {
            const latestVersionString: string = latestVersion.format();
            terminal.writeLine();
            terminal.writeLine(
              `An update to ${LSBRANCH_TOOL_FILENAME} is available. The latest version is ${latestVersionString} ` +
                `Run "npm install -g ${name}@${latestVersionString}" to update`
            );
          }
        };
      }
    }

    return new UpgradeMessagePrinter(printUpgradeMessageAsyncFunction);
  }

  public async printUpgradeMessageAsync(terminal: Terminal): Promise<void> {
    await this.#printUpgradeMessageAsyncFunction(terminal);
  }
}
