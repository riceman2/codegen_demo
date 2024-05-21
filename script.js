const fs = require('fs');
const readline = require('readline');
const { OpenAI } = require('openai');
const openai = new OpenAI({ key: process.env.OPENAI_API_KEY });

// originalCode.jsファイルからコードを読み込む
const originalCode = fs.readFileSync('originalCode.js', 'utf8');

// ユーザー入力を受け取るためのインターフェース
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// 特殊文字をエスケープする関数
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// コードの更新関数
function updateCodeWithReplacements(originalCode, replacements) {
    let updatedCode = originalCode;
    for (const { original, updated } of replacements) {
        const regex = new RegExp(escapeRegExp(original), 'g');
        updatedCode = updatedCode.replace(regex, updated);
    }
    return updatedCode;
}

// コードの削除関数
function deleteCodeSegments(originalCode, deletions) {
    let updatedCode = originalCode;
    for (const segment of deletions) {
        const regex = new RegExp(escapeRegExp(segment), 'g');
        updatedCode = updatedCode.replace(regex, '');
    }
    return updatedCode;
}

// コードの追加関数
function addCodeToEnd(originalCode, addition) {
    return originalCode + "\n" + addition;
}


// ユーザー入力から更新元と更新後のコードリストを生成または新しいコードを作成する関数
async function handleInstructions(instructions, originalCode) {
    const functions = [
        {
            type: "function",
            function: {
                name: "generate_replacements",
                description: "ユーザーの指示に基づいて更新元と更新後のJavaScriptコードリストを生成します。コードの更新が必要な場合はこちらの関数を利用して置換することで更新を行います",
                parameters: {
                    type: "object",
                    properties: {
                        replacements: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    original: { type: "string", description: "置換したい元のコード" },
                                    updated: { type: "string", description: "新しいコード" },
                                },
                                required: ["original", "updated"],
                            },
                            description: "元のコードと新しいコードの置換リスト",
                        },
                    },
                    required: ["replacements"],
                },
            },
        },
        {
            type: "function",
            function:
            {
                name: "create_or_add_code",
                description: "ユーザーの指示に基づいて新しいJavaScriptコードを生成または既存のコードに追加します。HTMLのコードは出力しないでください。",
                parameters: {
                    type: "object",
                    properties: {
                        new_code: { type: "string", description: "ユーザーの指示から出力されるJavaScriptコード" },
                    },
                    required: ["new_code"],
                },
            }
        },
        {
            type: "function",
            function:
            {
                name: "delete_code",
                description: "ユーザーの指示に基づいてコードの特定の部分を削除します",
                parameters: {
                    type: "object",
                    properties: {
                        deletions: {
                            type: "array",
                            items: { type: "string", description: "削除したいコードのセグメント" },
                            description: "削除するコードのセグメントのリスト",
                        },
                    },
                    required: ["deletions"],
                },
            }
        },
    ];

    const messages = [
        {
            role: "user",
            content: JSON.stringify({
                instructions: instructions,
                original: originalCode,
            }),
        },
    ];

    try {
        console.log("start")
        const response = await openai.chat.completions.create({
            model: "gpt-4o", // 必要に応じてモデルを変更
            messages: messages,
            tools: functions,
            tool_choice: "auto",
        });
        console.log(response)

        // 階層的にログ出力
        console.log("response.choices:");
        console.log(response.choices);

        if (response.choices && response.choices[0]) {
            console.log("response.choices[0].message:");
            console.log(response.choices[0].message);

            if (response.choices[0].message.tool_calls) {
                const allReplacements = [];
                const allDeletions = [];
                let newCode = "";

                response.choices[0].message.tool_calls.forEach((tool_call, index) => {
                    console.log(`response.choices[0].message.tool_calls[${index}]:`);
                    console.log(tool_call.function);

                    if (tool_call.function.name === "generate_replacements") {
                        const { replacements } = JSON.parse(tool_call.function.arguments);
                        console.log(`replacements from tool_call[${index}]:`);
                        console.log(replacements);
                        allReplacements.push(...replacements);
                    } else if (tool_call.function.name === "create_or_add_code") {
                        newCode = JSON.parse(tool_call.function.arguments).new_code;
                        console.log(`new code from tool_call[${index}]:`);
                        console.log(newCode);
                    } else if (tool_call.function.name === "delete_code") {
                        const { deletions } = JSON.parse(tool_call.function.arguments);
                        console.log(`deletions from tool_call[${index}]:`);
                        console.log(deletions);
                        allDeletions.push(...deletions);
                    } 
                });

                if (allReplacements.length > 0) {
                    const updatedCode = updateCodeWithReplacements(originalCode, allReplacements);
                    return { type: "update", code: updatedCode };
                }

                if (allDeletions.length > 0) {
                    const updatedCode = deleteCodeSegments(originalCode, allDeletions);
                    return { type: "delete", code: updatedCode };
                }

                if (newCode) {
                    const updatedCode = addCodeToEnd(originalCode, newCode);
                    return { type: "update", code: updatedCode };
                }
            } else {
                console.error("tool_calls is not found");
            }
        } else {
            console.error("choices[0] is not found");
        }

    } catch (error) {
        console.error("Function Calling中にエラーが発生しました:", error);
        return null;
    }
}

// ユーザーの指示をハードコード
// const userInstructions = `
// appIdのパラメーター名をApplicationIdに変更し、エラーメッセージを日本語にしてください。
// `;
const userInstructions = ``;

// ユーザー入力を受け取る関数
async function getUserInstructions() {
    return new Promise((resolve) => {
        rl.question("更新の指示を入力してください: ", (instructions) => {
            resolve(instructions);
        });
    });
}

// メイン関数
async function main() {
    let instructions;

    if (userInstructions.trim()) {
        instructions = userInstructions;
    } else {
        instructions = await getUserInstructions();
    }

    const result = await handleInstructions(instructions, originalCode);
    console.log(result)
    if (result) {
        const updatedFileName = "originalCode.js"; // ファイル名をハードコード
        if (result.type === "update") {
            fs.writeFileSync(updatedFileName, result.code);
            console.log(`コードが正常に更新されました。${updatedFileName}に保存されました。`);
        } else if (result.type === "delete") {
            fs.writeFileSync(updatedFileName, result.code);
            console.log(`コードが正常に削除されました${updatedFileName}に保存されました。`);
        }
    }

    rl.close();
}

main();