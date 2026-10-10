zai.register({
  name: 'Краткие ответы',
  systemPrompt: 'Отвечай максимально кратко и по делу: без вступлений, без повторов вопроса, без воды. Максимум пользы в минимуме слов.',
  transformInput: (text) => text,
  transformOutput: (text) => text
});
