import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
};

const run_mysql_query = tool(
    async ({ query }) => {
        // Clean and validate the query
        const cleanQuery = query.trim();

        if (!cleanQuery.toLowerCase().startsWith('select') &&
            !cleanQuery.toLowerCase().startsWith('describe') &&
            !cleanQuery.toLowerCase().startsWith('insert') &&
            !cleanQuery.toLowerCase().startsWith('show')) {
            return "Only SELECT, DESCRIBE, INSERT and SHOW queries are allowed for security reasons.";
        }

        let connection;
        try {
            connection = await mysql.createConnection(dbConfig);
            console.log(`Executing query: ${cleanQuery}`);

            if (cleanQuery.toLowerCase().startsWith('insert')) {
                const [result] = await connection.execute(cleanQuery);
                const { affectedRows, insertId } = result;

                if (affectedRows > 0) {
                    return `Query executed successfully. ${affectedRows} row(s) affected. Insert ID: ${insertId}`;
                } else {
                    return 'Query executed successfully but no rows were affected.';
                }
            }
            
            // This part of the code is for SELECT, DESCRIBE, INSERT and SHOW queries.
            const [rows] = await connection.execute(cleanQuery);

            if (!rows || rows.length === 0) {
                return 'Query executed successfully but returned no results. The table might be empty or your conditions did not match any records.';
            }

            // Better formatting for different types of data
            if (rows.length <= 10) {
                // For small results, show full details
                const formattedRows = rows.map((row, index) => {
                    const rowData = Object.entries(row)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ');
                    return `Row ${index + 1}: {${rowData}}`;
                }).join('\n');

                return `Found ${rows.length} record(s):\n${formattedRows}`;
            } else {
                // For large results, show summary + first few
                const sample = rows.slice(0, 5).map((row, index) => {
                    const rowData = Object.entries(row)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ');
                    return `Row ${index + 1}: {${rowData}}`;
                }).join('\n');

                return `Found ${rows.length} record(s). Showing first 5:\n${sample}\n... and ${rows.length - 5} more records.`;
            }

        } catch (error) {
            console.error('Database query error:', error);

            if (error.code === 'ER_NO_SUCH_TABLE') {
                return `Table not found. Please check the table name. Available tables might include: games, cards etc.`;
            } else if (error.code === 'ER_BAD_FIELD_ERROR') {
                return `Column not found. Please check your column names. Use DESCRIBE tablename to see available columns.`;
            } else {
                return `Database error: ${error.message}. Please check your SQL syntax.`;
            }
        } finally {
            if (connection) {
                await connection.end();
            }
        }
    },
    {
        name: 'run_mysql_query',
        description: `Executes SQL queries against a MySQL database.
        Use this for:
        - SELECT queries to retrieve data from tables
        - DESCRIBE queries to see table structure
        - SHOW TABLES to list available tables
        - INSERT queries to add new rows

        Common tables appear to be: blog_posts, users, langs, comments, etc.
        Always use the exact table names from the database.
        Example INSERT query: INSERT INTO cards (card_id, game_id, cardName, charName, leftTxt, rightTxt, cardDescTxt, trigger, cardVideo, leftNextCard, rightNextCard, leftChoiceEffects, rightChoiceEffects) VALUES (0, 1, 'f0', 'Arena', 'Careful and defensive', 'Focused to be faster and attacking', 'What kind of strategy you will apply in this fight?', 'None', 'arenaVideoFight2', 'fresult', 'fresult', '[{ "resourceName": "NF", "valueChange": 5 }]', '[{ "resourceName": "NF", "valueChange": 5 }]');`,
        schema: z.object({
            query: z.string().describe('The SQL query to execute (SELECT, DESCRIBE, SHOW, or INSERT)'),
        }),
    }
);

const generate_and_save_audio = tool(
    async ({ text, voice_name = "Charon" }) => {
        const outputDir = "sounds";
        const apiKey = process.env.GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

        try {
            await fs.mkdir(outputDir, { recursive: true });

            const payload = {
                contents: [{
                    parts: [{ text: text }]
                }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voice_name }
                        }
                    }
                },
                model: "gemini-2.5-flash-preview-tts"
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (!audioData || !mimeType) {
                return "No audio data was returned.";
            }

            // The API returns raw PCM audio data, which needs to be wrapped in a WAV header.
            const sampleRate = parseInt(mimeType.match(/rate=(\d+)/)?.[1] || 24000, 10);
            const bitsPerSample = parseInt(mimeType.match(/audio\/L(\d+)/)?.[1] || 16, 10);

            const pcmData = Buffer.from(audioData, 'base64');
            const numChannels = 1;
            const bytesPerSample = bitsPerSample / 8;
            const blockAlign = numChannels * bytesPerSample;
            const byteRate = sampleRate * blockAlign;
            const dataSize = pcmData.length;
            const chunkSize = 36 + dataSize;
            
            const wavHeader = new ArrayBuffer(44);
            const view = new DataView(wavHeader);

            // RIFF chunk
            view.setUint32(0, 0x52494646, false); 
            view.setUint32(4, chunkSize, true);
            view.setUint32(8, 0x57415645, false); 

            // fmt chunk
            view.setUint32(12, 0x666d7420, false); 
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); 
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, byteRate, true);
            view.setUint16(32, blockAlign, true);
            view.setUint16(34, bitsPerSample, true);

            view.setUint32(36, 0x64617461, false); 
            view.setUint32(40, dataSize, true);

            const wavBuffer = Buffer.concat([Buffer.from(wavHeader), pcmData]);
            const fileName = `audio_output_${uuidv4()}.wav`;
            const filePath = path.join(outputDir, fileName);

            await fs.writeFile(filePath, wavBuffer);

            return `Audio successfully saved to: ${filePath}`;

        } catch (error) {
            console.error('An error occurred during audio generation:', error);
            return `An error occurred during audio generation: ${error.message}`;
        }
    },
    {
        name: 'generate_and_save_audio',
        description: `Generates an audio file from the given text and saves it to the local file system. 
        The 'text' parameter is the content to convert to speech. 
        The 'voice_name' parameter specifies the voice to use, such as "Charon", "Kore", or "Puck".`,
        schema: z.object({
            text: z.string().describe('The content to convert to speech'),
            voice_name: z.string().optional().describe('The name of the voice to use for the speech (e.g., "Charon", "Puck"). Defaults to "Charon" if not specified.'),
        }),
    }
);

// Export all available tools in an array
export const tools = [
    run_mysql_query,
    generate_and_save_audio,
];