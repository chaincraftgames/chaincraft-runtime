import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { initChatModel } from 'langchain/chat_models/universal';

let model: BaseChatModel | undefined;

export const getModel = async (): Promise<BaseChatModel> => {
    if (!model) {
        model = await initChatModel(
          process.env.MODEL_NAME
        );
    }
    return model;
}