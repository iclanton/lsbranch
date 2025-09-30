// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { LSBranchCommandLineParser } from './cli/LSBranchCommandLineParser';

const parser: LSBranchCommandLineParser = new LSBranchCommandLineParser();

parser.executeAsync().catch((error: Error) => {
  parser.terminal.writeErrorLine(error.toString());
  process.exit(1);
});
