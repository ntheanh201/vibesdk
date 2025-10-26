/**
 * Utilities for updating project configuration files (package.json, wrangler.jsonc)
 */

import { modify, applyEdits } from 'jsonc-parser';

/**
 * Update the "name" field in package.json
 */
export function updatePackageJsonName(content: string, projectName: string): string {
    try {
        const parsed = JSON.parse(content);
        parsed.name = projectName;
        return JSON.stringify(parsed, null, 2);
    } catch (error) {
        throw new Error(`Failed to parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Update the "name" field in wrangler.jsonc
 */
export function updateWranglerJsoncName(content: string, projectName: string): string {
    try {
        // Create modification edit to update the name field
        const edits = modify(content, ['name'], projectName, {
            formattingOptions: {
                tabSize: 2,
                insertSpaces: true,
                eol: '\n'
            }
        });
        
        // Apply edits to get the modified content
        const modifiedContent = applyEdits(content, edits);
        
        return modifiedContent;
    } catch (error) {
        throw new Error(`Failed to parse wrangler.jsonc: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Generate a project name from blueprint or user query
 * Format: prefix-uniqueSuffix (all lowercase, alphanumeric + hyphens)
 * 
 * @param projectName - AI-generated project name from blueprint
 * @param uniqueSuffix - Random unique identifier
 * @param maxPrefixLength - Max length of prefix before suffix
 */
export function generateProjectName(
    projectName: string,
    uniqueSuffix: string,
    maxPrefixLength: number = 20
): string {
    let prefix = projectName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-');
    
    prefix = prefix.slice(0, maxPrefixLength);
    return `${prefix}-${uniqueSuffix}`.toLowerCase();
}
