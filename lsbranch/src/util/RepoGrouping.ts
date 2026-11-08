// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { Async, FileSystem } from '@rushstack/node-core-library';
import { AnsiEscape, ITerminal } from '@rushstack/terminal';
import { GitRepositoryError } from './GitRepository';
import { IGetRepoDataResult } from './RepoData';
import { getRepoIdentityAsync, IRepoIdentity } from './RepoIdentity';

const COLLATOR: Intl.Collator = new Intl.Collator('en', { sensitivity: 'base' });
type IdentityResult = { identity: IRepoIdentity } | { error: Error } | undefined;
interface ITraversalFrame {
  node: number;
  parent: number;
  neighbors: number[];
  nextNeighbor: number;
  children: number;
}

function compareRepos(left: IGetRepoDataResult, right: IGetRepoDataResult): number {
  const { repo: { alias: leftAlias, path: leftPath } } = left;
  const { repo: { alias: rightAlias, path: rightPath } } = right;
  return COLLATOR.compare(
    AnsiEscape.removeCodes(leftAlias || leftPath),
    AnsiEscape.removeCodes(rightAlias || rightPath)
  ) || COLLATOR.compare(leftPath, rightPath);
}

export async function groupRepoResultsAsync(
  results: IGetRepoDataResult[],
  terminal: ITerminal
): Promise<IGetRepoDataResult[][]> {
  const identities: IdentityResult[] = await Async.mapAsync(results, async (result): Promise<IdentityResult> => {
    if ('error' in result) {
      return undefined;
    }

    const { repo: { path } } = result;
    try {
      return { identity: await getRepoIdentityAsync(path) };
    } catch (error) {
      if (error instanceof Error && (error instanceof GitRepositoryError || FileSystem.isErrnoException(error))) {
        return { error };
      }

      throw error;
    }
  }, { concurrency: 15 });
  const keyMembers: Map<string, number[]> = new Map();
  const warnings: { result: IGetRepoDataResult; message: string }[] = [];
  for (let index: number = 0; index < identities.length; index++) {
    const entry: IdentityResult = identities[index];
    if (entry && 'identity' in entry) {
      const { identity: { commonDirectory, remoteKeys } } = entry;
      for (const key of [`git:${commonDirectory}`, ...remoteKeys]) {
        const members: number[] = keyMembers.get(key) ?? [];
        members.push(index);
        keyMembers.set(key, members);
      }
    } else if (entry) {
      const { repo: { alias, path } } = results[index];
      warnings.push({
        result: results[index],
        message: `Cannot determine repository group for ${JSON.stringify(alias || path)}: ${entry.error.message}`
      });
    }
  }

  // Shared identity nodes avoid building a quadratic clique for large groups of clones.
  const edges: Set<number>[] = results.map(() => new Set<number>());
  for (const members of keyMembers.values()) {
    if (members.length < 2) {
      continue;
    }

    const keyNode: number = edges.length;
    edges.push(new Set(members));
    for (const member of members) {
      edges[member].add(keyNode);
    }
  }

  const discovered: number[] = edges.map(() => -1);
  const lowest: number[] = edges.map(() => -1);
  const ambiguous: Set<number> = new Set();
  const groups: IGetRepoDataResult[][] = [];
  let counter: number = 0;

  function visit(node: number, parent: number, members: number[]): void {
    discovered[node] = lowest[node] = counter++;
    if (node < results.length) {
      members.push(node);
    }

    const stack: ITraversalFrame[] = [{
      node, parent, neighbors: [...edges[node]], nextNeighbor: 0, children: 0
    }];
    while (stack.length > 0) {
      const frame: ITraversalFrame = stack[stack.length - 1];
      const { node: current, parent: currentParent, neighbors, children } = frame;
      if (frame.nextNeighbor === neighbors.length) {
        stack.pop();
        if (currentParent >= 0) {
          lowest[currentParent] = Math.min(lowest[currentParent], lowest[current]);
          const parentFrame: ITraversalFrame = stack[stack.length - 1];
          if (parentFrame.parent >= 0 && lowest[current] >= discovered[currentParent] && currentParent < results.length) {
            ambiguous.add(currentParent);
          }
        } else if (children > 1 && current < results.length) {
          ambiguous.add(current);
        }

        continue;
      }

      const neighbor: number = neighbors[frame.nextNeighbor++];
      if (discovered[neighbor] < 0) {
        frame.children++;
        discovered[neighbor] = lowest[neighbor] = counter++;
        if (neighbor < results.length) {
          members.push(neighbor);
        }

        stack.push({
          node: neighbor, parent: current, neighbors: [...edges[neighbor]], nextNeighbor: 0, children: 0
        });
      } else if (neighbor !== currentParent) {
        lowest[current] = Math.min(lowest[current], discovered[neighbor]);
      }
    }
  }

  for (let index: number = 0; index < results.length; index++) {
    if (discovered[index] < 0) {
      const members: number[] = [];
      visit(index, -1, members);
      groups.push(members.map((member) => results[member]).sort(compareRepos));
    }
  }

  for (const index of ambiguous) {
    const result: IGetRepoDataResult = results[index];
    const { repo: { alias, path } } = result;
    warnings.push({
      result,
      message: `Ambiguous repository grouping: clone ${JSON.stringify(alias || path)} connects otherwise separate repository groups.`
    });
  }

  for (const { message } of warnings.sort((left, right) => compareRepos(left.result, right.result))) {
    terminal.writeWarningLine(message);
  }

  return groups.sort((left, right) => compareRepos(left[0], right[0]));
}
