// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

export class GitConfigError extends Error {}

export interface IGitConfigEntry {
  section: string;
  subsection: string;
  key: string;
  value: string;
}

function decodeConfigValue(raw: string): string {
  let value: string = '';
  let pendingSpaces: string = '';
  let quoted: boolean = false;
  for (let index: number = 0; index < raw.length; index++) {
    const character: string = raw[index];
    if (!quoted && (character === '#' || character === ';')) {
      break;
    }

    if (character === '"') {
      value += pendingSpaces;
      pendingSpaces = '';
      quoted = !quoted;
    } else if (character === '\\') {
      const escaped: string | undefined = raw[++index];
      const escapes: Record<string, string> = { n: '\n', t: '\t', b: '\b', '"': '"', '\\': '\\' };
      if (escaped === undefined || escapes[escaped] === undefined) {
        throw new GitConfigError('Invalid escape in Git configuration');
      }

      value += pendingSpaces + escapes[escaped];
      pendingSpaces = '';
    } else if (!quoted && /\s/.test(character)) {
      if (value) {
        pendingSpaces += character;
      }
    } else {
      value += pendingSpaces + character;
      pendingSpaces = '';
    }
  }

  if (quoted) {
    throw new GitConfigError('Unterminated quote in Git configuration');
  }

  return value;
}

function* getConfigLines(contents: string): Iterable<string> {
  let line: string = '';
  let quoted: boolean = false;
  let comment: boolean = false;
  for (let index: number = 0; index < contents.length; index++) {
    const character: string = contents[index];
    if (character === '\r' && contents[index + 1] === '\n') {
      continue;
    }

    if (character === '\n') {
      yield line;
      line = '';
      quoted = false;
      comment = false;
    } else if (!comment && character === '\\' && index + 1 < contents.length) {
      const nextCharacter: string = contents[++index];
      if (nextCharacter === '\r' && contents[index + 1] === '\n') {
        index++;
      } else if (nextCharacter !== '\n') {
        line += character + nextCharacter;
      }
    } else {
      if (!comment && character === '"') {
        quoted = !quoted;
      } else if (!quoted && (character === '#' || character === ';')) {
        comment = true;
      }

      line += character;
    }
  }

  yield line;
}

export function* parseGitConfig(contents: string): Iterable<IGitConfigEntry> {
  let section: string = '';
  let subsection: string = '';
  for (const line of getConfigLines(contents)) {
    if (!line.trim() || /^\s*[#;]/.test(line)) {
      continue;
    }

    if (line.trimStart().startsWith('[')) {
      const header: RegExpMatchArray | null = line.match(
        /^\s*\[([a-zA-Z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\]\s*(?:[#;].*)?$/
      );
      if (!header) {
        throw new GitConfigError('Invalid section header in Git configuration');
      }

      section = header[1].toLowerCase();
      subsection = header[2] === undefined ? '' : decodeConfigValue(`"${header[2]}"`);
      const legacySubsectionIndex: number = section.indexOf('.');
      if (legacySubsectionIndex >= 0) {
        subsection = section.slice(legacySubsectionIndex + 1);
        section = section.slice(0, legacySubsectionIndex);
      }

      continue;
    }

    const entry: RegExpMatchArray | null = line.match(
      /^\s*([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*(.*)|[#;].*)?$/
    );
    if (!entry || !section) {
      throw new GitConfigError('Invalid entry in Git configuration');
    }

    yield {
      section,
      subsection,
      key: entry[1].toLowerCase(),
      value: decodeConfigValue(entry[2] ?? 'true')
    };
  }
}
