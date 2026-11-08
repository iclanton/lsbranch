// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { ChildProcess } from 'node:child_process';
import { Executable, FileSystem, IWaitForExitResult, JsonFile } from '@rushstack/node-core-library';
import { AnsiEscape, Colorize } from '@rushstack/terminal';
import { LSBranchCommandLineParser } from '../LSBranchCommandLineParser';

describe(LSBranchCommandLineParser.name, () => {
  const missingConfigError: NodeJS.ErrnoException = Object.assign(new Error('Missing config'), {
    code: 'ENOENT',
    errno: -2,
    syscall: 'open'
  });
  let parser: LSBranchCommandLineParser;
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
    // ts-command-line calls process.exit() which interferes with Jest
    jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`Test code called process.exit(${code})`);
    });

    // This call may terminate the entire test run because it invokes process.exit()
    // if it encounters errors.
    // TODO Remove the calls to process.exit() or override them for testing.
    parser = new LSBranchCommandLineParser();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = previousExitCode;
  });

  it('prints the global help', () => {
    const helpText: string = AnsiEscape.formatForTests(parser.renderHelpText());
    expect(helpText).toMatchSnapshot();
  });

  it('prints the help for each action', () => {
    for (const action of parser.actions) {
      const helpText: string = AnsiEscape.formatForTests(action.renderHelpText());
      expect(helpText).toMatchSnapshot(action.actionName);
    }
  });

  it('lists the current branch as JSON', async () => {
    const repoPath: string = path.resolve('fixture-repo');
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine').mockImplementation(() => {});
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: repoPath, alias: 'Repo' }],
      lastUpdateCheck: Date.now()
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue('ref: refs/heads/feature/nested\n');

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--json']);

    expect(process.exitCode).toBe(0);
    expect(writeLine).toHaveBeenCalledWith(
      JSON.stringify([
        { repo: { path: repoPath, alias: 'Repo' }, data: { checkedOutBranch: 'feature/nested' } }
      ])
    );
  });

  it('adds a repository while loading the configuration only once', async () => {
    const repoPath: string = path.resolve('fixture-repo');
    const loadConfig: jest.SpyInstance = jest
      .spyOn(JsonFile, 'loadAndValidateAsync')
      .mockRejectedValue(missingConfigError);
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue('ref: refs/heads/main\n');

    await parser.executeAsync([
      '--config',
      'fixture-config.json',
      'add',
      '--path',
      repoPath,
      '--alias',
      'Repo'
    ]);

    expect(process.exitCode).toBe(0);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(saveConfig).toHaveBeenCalledWith(
      { repos: [{ path: repoPath, alias: 'Repo' }], lastUpdateCheck: expect.any(Number) },
      path.resolve('fixture-config.json'),
      { updateExistingFile: true, prettyFormatting: true }
    );
  });

  it('reports a missing configuration', async () => {
    const { terminal } = parser;
    const writeErrorLine: jest.SpyInstance = jest
      .spyOn(terminal, 'writeErrorLine')
      .mockImplementation(() => {});
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockRejectedValue(missingConfigError);

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--json']);

    expect(process.exitCode).toBe(1);
    expect(writeErrorLine).toHaveBeenCalledWith(
      `Config file does not exist: ${path.resolve('fixture-config.json')}`
    );
  });

  it('rejects duplicate repositories without saving', async () => {
    const repoPath: string = path.resolve('fixture-repo');
    const { terminal } = parser;
    const writeErrorLine: jest.SpyInstance = jest
      .spyOn(terminal, 'writeErrorLine')
      .mockImplementation(() => {});
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: repoPath }],
      lastUpdateCheck: Date.now()
    });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);

    await parser.executeAsync([
      '--config',
      'fixture-config.json',
      'add',
      '--path',
      repoPath,
      '--no-validate'
    ]);

    expect(process.exitCode).toBe(1);
    expect(writeErrorLine).toHaveBeenCalledWith(`Repo path "${repoPath}" already exists`);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent repository without saving', async () => {
    const repoPath: string = path.resolve('missing-repo');
    const { terminal } = parser;
    const writeErrorLine: jest.SpyInstance = jest
      .spyOn(terminal, 'writeErrorLine')
      .mockImplementation(() => {});
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [],
      lastUpdateCheck: Date.now()
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockRejectedValue(missingConfigError);
    jest.spyOn(FileSystem, 'existsAsync').mockResolvedValue(false);
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);

    await parser.executeAsync(['--config', 'fixture-config.json', 'add', '--path', repoPath]);

    expect(process.exitCode).toBe(1);
    expect(writeErrorLine).toHaveBeenCalledWith("Specified repo path is not valid: .git folder doesn't exist");
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('lists all branches and individual Git failures with aligned continuation rows', async () => {
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine').mockImplementation(() => {});
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [
        { path: path.resolve('valid-repo'), alias: 'Valid' },
        { path: path.resolve('invalid-repo'), alias: 'Invalid' }
      ],
      lastUpdateCheck: Date.now()
    });
    jest.spyOn(Executable, 'spawn').mockReturnValue(new ChildProcess());
    const successResult: IWaitForExitResult<string> = {
      exitCode: 0,
      signal: null,
      stdout: '* main\n  feature\n',
      stderr: ''
    };
    const errorResult: IWaitForExitResult<string> = {
      exitCode: 128,
      signal: null,
      stdout: '',
      stderr: 'not a git repository'
    };
    jest
      .spyOn(Executable, 'waitForExitAsync')
      .mockResolvedValueOnce(successResult)
      .mockResolvedValueOnce(errorResult);

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--all']);

    expect(process.exitCode).toBe(0);
    expect(writeLine).toHaveBeenNthCalledWith(1, 'Valid', '    ', Colorize.green('main'));
    expect(writeLine).toHaveBeenNthCalledWith(2, '         ', 'feature');
    expect(writeLine).toHaveBeenNthCalledWith(
      3,
      'Invalid',
      '  ',
      Colorize.red('git branch failed with exit code 128: not a git repository')
    );
  });

  it('prints an upgrade notice from the registry latest tag', async () => {
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine').mockImplementation(() => {});
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [], lastUpdateCheck: 0 });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ 'dist-tags': { latest: '99.0.0' }, versions: {} })));

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls']);

    expect(process.exitCode).toBe(0);
    expect(writeLine).toHaveBeenCalledWith(
      expect.stringContaining('The latest version is 99.0.0 Run "npm install -g lsbranch@99.0.0"')
    );
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });
});
