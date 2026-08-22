import * as fs from 'fs';
import * as path from 'path';

async function findFilesInDir(startPath: string, filter: RegExp, exclude: RegExp): Promise<string[]> {
  let results: string[] = [];
  const files = await fs.promises.readdir(startPath);

  for (const file of files) {
    const filename = path.join(startPath, file);
    const stat = await fs.promises.lstat(filename);

    if (exclude.test(filename)) {
      continue;
    }

    if (stat.isDirectory()) {
      results = results.concat(await findFilesInDir(filename, filter, exclude));
    } else if (filter.test(filename)) {
      results.push(filename);
    }
  }
  return results;
}

export async function codebaseSearch(query: string, filePattern: string = '.*\.ts$|.*\.tsx$|.*\.js$|.*\.jsx$|.*\.mjs$|.*\.cjs$|.*\.md$|.*\.json$|.*\.yaml$|.*\.yml$|.*\.css$|.*\.scss$|.*\.html$'): Promise<string> {
  const rootDir = process.cwd(); // Assuming current working directory is the repo root
  const excludeDirs = /node_modules|.git|.next|dist|build|coverage/;
  const fileFilter = new RegExp(filePattern);
  const searchResults: string[] = [];
  const lowerCaseQuery = query.toLowerCase();

  try {
    const filesToSearch = await findFilesInDir(rootDir, fileFilter, excludeDirs);

    for (const filePath of filesToSearch) {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      let matches: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerCaseQuery)) {
          // Add context around the match
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);
          for (let j = start; j < end; j++) {
            matches.push(`${j + 1}: ${lines[j]}`);
          }
          matches.push('---'); // Separator for different match blocks
          if (matches.length > 10) break; // Limit matches per file
        }
      }

      if (matches.length > 0) {
        searchResults.push(`File: ${filePath}\n${matches.join('\n')}`);
        if (searchResults.length > 5) break; // Limit files in results
      }
    }

    if (searchResults.length === 0) {
      return `No matches found for "${query}" with pattern "${filePattern}".`;
    }

    return searchResults.join('\n\n');
  } catch (error: any) {
    return `Error during codebase search: ${error.message}`;
  }
}

// Ensure fs and path are available, common in Node.js environments.
// This tool assumes a Node.js execution context for fs and path modules.
