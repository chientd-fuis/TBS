/* Câu trả lời "vui" cố định của các khung chat AI (không gọi AI → không tốn token). */

/** Câu hỏi không liên quan tới quán */
export const OFFTOPIC_QUIPS = [
  "Tao chỉ là trợ lý quèn của quán Tiệm Bơ Sầu, những câu hỏi ngoài quán tao không trả lời được, mày hỏi Gemini, ChatGPT,... đi.",
  "Tao chịu!!!",
  "Chịu chết, hỏi câu khác đi!",
];

/** Hết lượt hỏi */
export const LIMIT_QUIPS = ["Mày không nên biết quá nhiều. Hỏi thế thôi!", "Mày đã hết sự trợ giúp.", "Hết cứu!!", "Mày đã biết quá nhiều rồi."];

export const pickQuip = (list: string[]) => list[Math.floor(Math.random() * list.length)];
