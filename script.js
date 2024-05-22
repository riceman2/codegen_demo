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

const systemMessageText = `
あなたはJavaScriptコード生成アシスタントです。ユーザーの指示に応じてJavaScriptファイルを作成してください。
function_callingを２つ用意していて、
* 作成と追加は「create_or_add_code」
* 更新や削除は「generate_replacements」
を利用してください。

注意１: コードを削除する場合は、置換するコードを空文字列に設定してください。同じコードが複数回現れる場合は、特定の箇所のみが削除されるように注意してください。
注意２: コードの更新や削除の場合は同じコードが複数存在することがあります。その場合はどれのプログラムを更新/削除するかを特定して検索置換するためのプログラムを前後2~3行の出力を行ってください。

例えば同じコードが連続して並んでいて１つだけを残したい場合は、
[{
    original:"console.log('hoge');\nalert('huga');\nconsole.log('hoge');\nalert('huga');"
    updated:"console.log('hoge');\nalert('huga');"
}]
というように１つだけを残して出力すると、全部が消えることはありません。
`

// 会話履歴を読み取る関数
function readConversationHistory(filePath) {
    const systemMessage = {
        role: "system",
        content: systemMessageText
    };

    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        try {
            const conversation = JSON.parse(data);
            if (conversation.messages.length === 0) {
                conversation.messages.push(systemMessage);
            }
            return conversation;
        } catch (error) {
            // ファイルが空または無効なJSONの場合、空の会話履歴を返す
            return { messages: [systemMessage] };
        }
    } else {
        return { messages: [systemMessage] };
    }
}

// 会話結果を保存する関数
function saveConversationHistory(filePath, conversation) {
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
}


// ユーザー入力から更新元と更新後のコードリストを生成または新しいコードを作成する関数
async function handleInstructions(instructions, originalCode, conversation) {
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
                                    updated: { type: "string", description: "新しいコード（削除の場合は空文字列）" },
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
        }
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

    conversation.messages.push(...messages);

    try {
        console.log("start")
        const response = await openai.chat.completions.create({
            model: "gpt-4o", // 必要に応じてモデルを変更
            messages: conversation.messages,
            tools: functions,
            tool_choice: "auto",
        });
        console.log(response)

        // 階層的にログ出力
        console.log("response.choices:");
        console.log(response.choices);

        if (response.choices && response.choices[0]) {
            const choice = response.choices[0];
            if (choice.message.tool_calls) {
                const allReplacements = [];
                let newCode = "";

                choice.message.tool_calls.forEach((tool_call, index) => {
                    const tool_response = tool_call.function;
                    conversation.messages.push({
                        role: "assistant",
                        content: JSON.stringify(tool_response.arguments)
                    });

                    if (tool_call.function.name === "generate_replacements") {
                        const { replacements } = JSON.parse(tool_call.function.arguments);
                        console.log(`replacements from tool_call[${index}]:`);
                        console.log(replacements);
                        allReplacements.push(...replacements);
                    } else if (tool_call.function.name === "create_or_add_code") {
                        newCode = JSON.parse(tool_call.function.arguments).new_code;
                        console.log(`new code from tool_call[${index}]:`);
                        console.log(newCode);
                    }
                });

                if (allReplacements.length > 0) {
                    const updatedCode = updateCodeWithReplacements(originalCode, allReplacements);
                    return { type: "update", code: updatedCode };
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

    return null;
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
    const conversationHistoryPath = 'conversation_history.json';
    let conversation = readConversationHistory(conversationHistoryPath);

    let instructions;

    if (userInstructions.trim()) {
        instructions = userInstructions;
    } else {
        instructions = await getUserInstructions();
    }

    const result = await handleInstructions(instructions, originalCode, conversation);
    console.log(result)
    if (result) {
        const updatedFileName = "originalCode.js"; // ファイル名をハードコード
        if (result.type === "update") {
            fs.writeFileSync(updatedFileName, result.code);
            console.log(`コードが正常に更新されました。${updatedFileName}に保存されました。`);
        } else if (result.type === "delete") {
            fs.writeFileSync(updatedFileName, result.code);
            console.log(`コードが正常に削除されました。${updatedFileName}に保存されました。`);
        }
    }
    saveConversationHistory(conversationHistoryPath, conversation);

    rl.close();
}

main();