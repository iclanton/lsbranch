// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { Async, FileSystem, JsonFile } from '@rushstack/node-core-library';
import { AnsiEscape, Colorize, ConsoleTerminalProvider, StringBufferTerminalProvider } from '@rushstack/terminal';
import { LSBranchCommandLineParser } from '../LSBranchCommandLineParser';
import * as RepoData from '../../util/RepoData';
import * as GitRepository from '../../util/GitRepository';
import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';

describe(LSBranchCommandLineParser.name, () => {
  const missingConfigError: NodeJS.ErrnoException = Object.assign(new Error('Missing config'), {
    code: 'ENOENT',
    errno: -2,
    syscall: 'open'
  });
  let parser: LSBranchCommandLineParser;
  let terminalProvider: StringBufferTerminalProvider;
  let previousExitCode: typeof process.exitCode;

  function getTerminalOutput(): string[] {
    const projectPath: string = process.cwd();
    const escapedProjectPath: string = JSON.stringify(projectPath).slice(1, -1);
    return terminalProvider.getAllOutputAsChunks({ asLines: true }).map((line) =>
      line
        .replaceAll(escapedProjectPath, '<project>')
        .replaceAll(projectPath, '<project>')
        .replaceAll('\\\\', '/')
        .replaceAll('\\', '/')
    );
  }

  beforeEach(() => {
    previousExitCode = process.exitCode;
    // ts-command-line calls process.exit() which interferes with Jest
    jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`Test code called process.exit(${code})`);
    });

    // This call may terminate the entire test run because it invokes process.exit()
    // if it encounters errors.
    // TODO Remove the calls to process.exit() or override them for testing.
    jest.spyOn(ConsoleTerminalProvider.prototype, 'write').mockImplementation(() => {});
    parser = new LSBranchCommandLineParser();
    terminalProvider = new StringBufferTerminalProvider(true);
    parser.terminal.registerProvider(terminalProvider);
    jest.spyOn(GitRepository, 'getGitPathsAsync').mockImplementation(async (repoPath) => {
      const gitDirectory: string = path.join(repoPath, '.git');
      return { gitDirectory, commonDirectory: gitDirectory };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = previousExitCode;
  });

  it('prints the global help', () => {
    const helpText: string = AnsiEscape.formatForTests(parser.renderHelpText());
    expect(helpText).toMatchSnapshot();
  });

  it.each([false, true])('finds checked-out and non-checked-out local branches with JSON=%s', async (json) => {
    const repos: LSBranchConfigurationSchemaRepo[] = [
      { path: '/repos/one', alias: 'One' },
      { path: '/repos/two', alias: 'Two' },
      { path: '/repos/three', alias: 'Three' },
      { path: '/repos/bad', alias: 'Bad' }
    ];
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos, lastUpdateCheck: Date.now() });
    const lookup: jest.SpyInstance = jest.spyOn(RepoData, 'getRepoDataAsync')
      .mockResolvedValueOnce({ repo: repos[0], data: { checkedOutBranch: 'main', hasLocalBranch: true } })
      .mockResolvedValueOnce({ repo: repos[1], data: { checkedOutBranch: 'feature', hasLocalBranch: true } })
      .mockResolvedValueOnce({ repo: repos[2], data: { checkedOutBranch: 'topic', hasLocalBranch: false } })
      .mockResolvedValueOnce({ repo: repos[3], error: new Error('Unreadable repository') });
    const args: string[] = ['find', '--branch', 'main'];
    if (json) {
      args.push('--json');
    }

    await parser.executeAsync(args);

    expect(process.exitCode).toBe(0);
    expect(lookup).toHaveBeenNthCalledWith(1, repos[0], false, 'main');
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it.each([false, true])('reports no branch matches with JSON=%s', async (json) => {
    const repo: LSBranchConfigurationSchemaRepo = { path: '/repo', alias: 'Repo' };
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [repo], lastUpdateCheck: Date.now() });
    jest.spyOn(RepoData, 'getRepoDataAsync').mockResolvedValue({
      repo, data: { checkedOutBranch: 'main', hasLocalBranch: false }
    });
    const args: string[] = ['find', '--branch', 'absent'];
    if (json) {
      args.push('--json');
    }

    await parser.executeAsync(args);

    expect(process.exitCode).toBe(0);
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it.each(['../main', 'bad branch', 'name.lock', 'main?'])('rejects invalid local branch name %j', async (branch) => {
    const lookup: jest.SpyInstance = jest.spyOn(RepoData, 'getRepoDataAsync');

    await parser.executeAsync(['find', '--branch', branch, '--json']);

    expect(process.exitCode).toBe(1);
    expect(lookup).not.toHaveBeenCalled();
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('requires a branch name for find', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(parser.executeWithoutErrorHandlingAsync(['find', '--json'])).rejects.toThrow();
  });

  it.each(['path', 'alias'])('unregisters a clone by %s without Git lookups', async (selector) => {
    const repoPath: string = path.resolve('fixture-repo');
    const retainedRepo: LSBranchConfigurationSchemaRepo = { path: path.resolve('retained-repo'), alias: 'Retained' };
    const lastUpdateCheck: number = Date.now();
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: repoPath, alias: 'Repo' }, retainedRepo], lastUpdateCheck
    });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const lookup: jest.SpyInstance = jest.spyOn(RepoData, 'getRepoDataAsync');
    const args: string[] = ['--config', 'fixture-config.json', 'remove'];
    args.push(...(selector === 'path' ? ['--path', 'fixture-repo'] : ['--alias', 'Repo']));

    await parser.executeAsync(args);

    expect(process.exitCode).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
    expect(saveConfig).toHaveBeenCalledWith(
      { repos: [retainedRepo], lastUpdateCheck },
      path.resolve('fixture-config.json'),
      { updateExistingFile: true, prettyFormatting: true }
    );
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it.each([[], ['--path', '/repo', '--alias', 'Repo']])(
    'requires exactly one removal selector for arguments %j',
    async (...args) => {
      jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [], lastUpdateCheck: Date.now() });
      const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);

      await parser.executeAsync(['remove', ...args]);

      expect(process.exitCode).toBe(1);
      expect(saveConfig).not.toHaveBeenCalled();
      expect(getTerminalOutput()).toMatchSnapshot('terminal output');
    }
  );

  it('reports removal of an unregistered alias', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [], lastUpdateCheck: Date.now() });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);

    await parser.executeAsync(['remove', '--alias', 'Absent']);

    expect(process.exitCode).toBe(1);
    expect(saveConfig).not.toHaveBeenCalled();
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('prints the help for each action', () => {
    for (const action of parser.actions) {
      const helpText: string = AnsiEscape.formatForTests(action.renderHelpText());
      expect(helpText).toMatchSnapshot(action.actionName);
    }
  });

  it.each([
    [],
    ['--config', 'fixture-config.json'],
    ['-c', 'fixture-config.json'],
    ['--config=fixture-config.json'],
    ['-cfixture-config.json']
  ])('defaults to listing for arguments %j', async (...args) => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: '/repo', alias: 'Repo' }],
      lastUpdateCheck: Date.now()
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue('ref: refs/heads/main\n');
    const originalArgs: string[] = [...args];

    await parser.executeAsync(args);

    expect(process.exitCode).toBe(0);
    expect(parser.selectedAction?.actionName).toBe('ls');
    expect(getTerminalOutput()).toEqual(['[    log] Repo  main[n]']);
    expect(args).toEqual(originalArgs);
  });

  it('accepts listing flags without an explicit action', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: '/repo', alias: 'Repo' }],
      lastUpdateCheck: Date.now()
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue('ref: refs/heads/main\n');

    await parser.executeAsync(['--config', 'fixture-config.json', '--json']);

    expect(process.exitCode).toBe(0);
    expect(parser.selectedAction?.actionName).toBe('ls');
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('preserves global help without executing an action', async () => {
    const printHelp: jest.SpyInstance = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await parser.executeWithoutErrorHandlingAsync(['--help']);

    expect(parser.selectedAction).toBeUndefined();
    expect(printHelp).toHaveBeenCalledWith(expect.stringContaining('usage: lsbranch'));
    expect(getTerminalOutput()).toEqual([]);
  });

  it.each([['--config'], ['--config', '--json'], ['unknown-action']])(
    'preserves invalid argument errors for %j',
    async (...args) => {
      jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      await expect(parser.executeWithoutErrorHandlingAsync(args)).rejects.toThrow();
      expect(parser.selectedAction).toBeUndefined();
    }
  );

  it('lists the current branch as JSON', async () => {
    const repoPath: string = path.resolve('fixture-repo');
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine');
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
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
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
      'fixture-repo',
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
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('reports a missing configuration', async () => {
    const { terminal } = parser;
    const writeErrorLine: jest.SpyInstance = jest.spyOn(terminal, 'writeErrorLine');
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockRejectedValue(missingConfigError);

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--json']);

    expect(process.exitCode).toBe(1);
    expect(writeErrorLine).toHaveBeenCalledWith(
      `Config file does not exist: ${path.resolve('fixture-config.json')}`
    );
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('rejects duplicate repositories without saving', async () => {
    const repoPath: string = path.resolve('fixture-repo');
    const { terminal } = parser;
    const writeErrorLine: jest.SpyInstance = jest.spyOn(terminal, 'writeErrorLine');
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
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('rejects a nonexistent repository without saving', async () => {
    const repoPath: string = path.resolve('missing-repo');
    const { terminal } = parser;
    const writeErrorLine: jest.SpyInstance = jest.spyOn(terminal, 'writeErrorLine');
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [],
      lastUpdateCheck: Date.now()
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockRejectedValue(missingConfigError);
    jest.spyOn(FileSystem, 'existsAsync').mockResolvedValue(false);
    jest
      .spyOn(GitRepository, 'getGitPathsAsync')
      .mockRejectedValue(new GitRepository.GitRepositoryError(".git folder doesn't exist"));
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);

    await parser.executeAsync(['--config', 'fixture-config.json', 'add', '--path', repoPath]);

    expect(process.exitCode).toBe(1);
    expect(writeErrorLine).toHaveBeenCalledWith("Specified repo path is not valid: .git folder doesn't exist");
    expect(saveConfig).not.toHaveBeenCalled();
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('lists all branches and individual Git failures with aligned continuation rows', async () => {
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine');
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [
        { path: path.resolve('valid-repo'), alias: 'Valid' },
        { path: path.resolve('invalid-repo'), alias: 'Invalid' }
      ],
      lastUpdateCheck: Date.now()
    });
    jest
      .spyOn(RepoData, 'getRepoDataAsync')
      .mockResolvedValueOnce({
        repo: { path: path.resolve('valid-repo'), alias: 'Valid' },
        data: { checkedOutBranch: 'main', otherBranches: ['feature'] }
      })
      .mockResolvedValueOnce({
        repo: { path: path.resolve('invalid-repo'), alias: 'Invalid' },
        error: new Error('git branch failed with exit code 128: not a git repository')
      });

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--all']);

    expect(process.exitCode).toBe(0);
    expect(writeLine).toHaveBeenNthCalledWith(1, `Valid    ${Colorize.green('main')}`);
    expect(writeLine).toHaveBeenNthCalledWith(2, '         feature');
    expect(writeLine).toHaveBeenNthCalledWith(
      3,
      `Invalid  ${Colorize.red('git branch failed with exit code 128: not a git repository')}`
    );
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('aligns borderless table columns using the visible width of colored aliases', async () => {
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine');
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [
        { path: path.resolve('short-repo'), alias: Colorize.cyan('Repo') },
        { path: path.resolve('long-repo'), alias: 'Longer' }
      ],
      lastUpdateCheck: Date.now()
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue('ref: refs/heads/main\n');

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls']);

    expect(process.exitCode).toBe(0);
    expect(writeLine).toHaveBeenNthCalledWith(1, `${Colorize.cyan('Repo')}    main`);
    expect(writeLine).toHaveBeenNthCalledWith(2, 'Longer  main');
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('prints no table rows when no repositories are configured', async () => {
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine');
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [],
      lastUpdateCheck: Date.now()
    });

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls']);

    expect(process.exitCode).toBe(0);
    expect(writeLine).not.toHaveBeenCalled();
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('lists only non-checked-out branches in text output', async () => {
      const repo: LSBranchConfigurationSchemaRepo = { path: '/repo', alias: 'Repo' };
      jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [repo], lastUpdateCheck: Date.now() });
      const lookup: jest.SpyInstance = jest.spyOn(RepoData, 'getRepoDataAsync').mockResolvedValue({
        repo,
        data: { checkedOutBranch: 'main', otherBranches: ['feature', 'topic'] }
      });

      await parser.executeAsync(['--other']);

      expect(process.exitCode).toBe(0);
      expect(lookup).toHaveBeenCalledWith(repo, true);
      expect(getTerminalOutput()).toMatchSnapshot('terminal output');
    });

  it('lists only non-checked-out branches in JSON output', async () => {
      const repo: LSBranchConfigurationSchemaRepo = { path: '/repo', alias: 'Repo' };
      jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [repo], lastUpdateCheck: Date.now() });
      jest.spyOn(RepoData, 'getRepoDataAsync').mockResolvedValue({
        repo,
        data: { checkedOutBranch: 'main', otherBranches: ['feature', 'topic'] }
      });

      await parser.executeAsync(['ls', '--other', '--json']);

      expect(process.exitCode).toBe(0);
      expect(getTerminalOutput()).toMatchSnapshot('terminal output');
    });

  it('omits text rows for clones with no other branches', async () => {
      const repo: LSBranchConfigurationSchemaRepo = { path: '/repo', alias: 'Repo' };
      jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [repo], lastUpdateCheck: Date.now() });
      jest.spyOn(RepoData, 'getRepoDataAsync').mockResolvedValue({
        repo,
        data: { checkedOutBranch: 'main', otherBranches: [] }
      });

      await parser.executeAsync(['--other']);

      expect(process.exitCode).toBe(0);
      expect(getTerminalOutput()).toEqual([]);
    });

  it('rejects combining --other and --all', async () => {
      await parser.executeAsync(['--other', '--all', '--json']);

      expect(process.exitCode).toBe(1);
      expect(getTerminalOutput()).toMatchSnapshot('terminal output');
    });

  it.each([false, true])(
    'limits repository lookups to 15 and preserves JSON order with --all=%s',
    async (getAllBranches) => {
      const repos: LSBranchConfigurationSchemaRepo[] = Array.from({ length: 35 }, (value, index) => ({
        path: path.resolve(`repo-${index}`)
      }));
      const repoIndexes: Map<string, number> = new Map(repos.map((repo, index) => [repo.path, index]));
      const { terminal } = parser;
      const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine');
      jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
        repos,
        lastUpdateCheck: Date.now()
      });
      let activeLookups: number = 0;
      let maximumActiveLookups: number = 0;
      const lookup: jest.SpyInstance = jest
        .spyOn(RepoData, 'getRepoDataAsync')
        .mockImplementation(async (repo, allBranches) => {
          const { path: repoPath } = repo;
          const index: number | undefined = repoIndexes.get(repoPath);
          if (index === undefined) {
            throw new Error(`Unexpected repository lookup: ${repoPath}`);
          }

          activeLookups++;
          maximumActiveLookups = Math.max(maximumActiveLookups, activeLookups);
          await Async.sleepAsync((repos.length - index) % 4);
          activeLookups--;
          return {
            repo,
            data: {
              checkedOutBranch: `branch-${index}`,
              ...(allBranches ? { otherBranches: [`other-${index}`] } : {})
            }
          };
        });
      const args: string[] = ['--config', 'fixture-config.json', 'ls', '--json'];
      if (getAllBranches) {
        args.push('--all');
      }

      await parser.executeAsync(args);

      expect(process.exitCode).toBe(0);
      expect(maximumActiveLookups).toBe(15);
      expect(activeLookups).toBe(0);
      expect(lookup).toHaveBeenCalledTimes(repos.length);
      expect(writeLine).toHaveBeenCalledWith(
        JSON.stringify(
          repos.map((repo, index) => ({
            repo,
            data: {
              checkedOutBranch: `branch-${index}`,
              ...(getAllBranches ? { otherBranches: [`other-${index}`] } : {})
            }
          }))
        )
      );
    }
  );

  it('prints an upgrade notice from the registry latest tag', async () => {
    const { terminal } = parser;
    const writeLine: jest.SpyInstance = jest.spyOn(terminal, 'writeLine');
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
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('prints branch names and detached HEADs with an unaliased repository', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [
        { path: '/repos/main', alias: 'Main' },
        { path: '/repos/feature', alias: 'Feature' },
        { path: '/repos/detached' }
      ],
      lastUpdateCheck: Date.now()
    });
    jest
      .spyOn(FileSystem, 'readFileAsync')
      .mockResolvedValueOnce('ref: refs/heads/main\n')
      .mockResolvedValueOnce('ref: refs/heads/feature/nested\n')
      .mockResolvedValueOnce('0123456789abcdef0123456789abcdef01234567\n');

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls']);

    expect(process.exitCode).toBe(0);
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('prints mixed success and error results as JSON without upgrade notices', async () => {
    const validRepo: LSBranchConfigurationSchemaRepo = { path: '/repos/valid', alias: 'Valid' };
    const invalidRepo: LSBranchConfigurationSchemaRepo = { path: '/repos/invalid', alias: 'Invalid' };
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [validRepo, invalidRepo],
      lastUpdateCheck: 0
    });
    jest
      .spyOn(RepoData, 'getRepoDataAsync')
      .mockResolvedValueOnce({
        repo: validRepo,
        data: { checkedOutBranch: 'main', otherBranches: ['feature', 'other'] }
      })
      .mockResolvedValueOnce({ repo: invalidRepo, error: new Error('not a git repository') });
    const fetchRegistry: jest.SpyInstance = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected registry request'));

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--all', '--json']);

    expect(process.exitCode).toBe(0);
    expect(fetchRegistry).not.toHaveBeenCalled();
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('reports unexpected configuration failures', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockRejectedValue(new Error('Invalid configuration'));

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--json']);

    expect(process.exitCode).toBe(1);
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('rejects configuration with an empty repository path', async () => {
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue(JSON.stringify({ repos: [{ path: '' }] }));
    const lookup: jest.SpyInstance = jest.spyOn(RepoData, 'getRepoDataAsync');

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--json']);

    expect(process.exitCode).toBe(1);
    expect(terminalProvider.getErrorOutput()).toContain('fewer than 1 character');
    expect(lookup).not.toHaveBeenCalled();
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('rejects configuration with a relative repository path', async () => {
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue(JSON.stringify({ repos: [{ path: '.' }] }));
    const lookup: jest.SpyInstance = jest.spyOn(RepoData, 'getRepoDataAsync');

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls', '--json']);

    expect(process.exitCode).toBe(1);
    expect(terminalProvider.getErrorOutput()).toContain('absolute-path');
    expect(lookup).not.toHaveBeenCalled();
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('reports unconfigured repositories at the default config path', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockRejectedValue(missingConfigError);

    await parser.executeAsync(['ls', '--json']);

    expect(process.exitCode).toBe(1);
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });

  it('prints the repository table before its upgrade notice', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: '/repos/main', alias: 'Repo' }],
      lastUpdateCheck: 0
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue('ref: refs/heads/main\n');
    jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ 'dist-tags': { latest: '99.0.0' }, versions: {} })));

    await parser.executeAsync(['--config', 'fixture-config.json', 'ls']);

    expect(process.exitCode).toBe(0);
    expect(getTerminalOutput()).toMatchSnapshot('terminal output');
  });
});
