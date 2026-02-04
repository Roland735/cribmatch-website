// models/Message.js
import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
    {
        phone: { type: String, index: true },         // sender phone (digits only)
        from: { type: String },                       // 'user' | 'agent' | 'system'
        wa_message_id: { type: String, index: true }, // WhatsApp/WhatChimp message id
        type: { type: String },                       // text / interactive / media / status
        text: { type: String, default: "" },          // parsed short text content
        raw: { type: mongoose.Schema.Types.Mixed },
        status: { type: String },                     // delivered / read / failed etc.
        meta: { type: mongoose.Schema.Types.Mixed },  // extra fields (buttons, postback id, media)
        conversationId: { type: String, index: true } // optional conversation grouping
    },
    { timestamps: true, versionKey: false }
);

const Message = mongoose.models.Message || mongoose.model("Message", MessageSchema);
export default Message;
