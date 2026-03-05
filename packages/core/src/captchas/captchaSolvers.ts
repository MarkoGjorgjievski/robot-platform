module.exports.Solvers = class {
  // constructor(context) {
  //   this.context = context;
  // }
  static naverOpenAISkeletonBody = {
    model: 'gpt-4.1-mini',
    instructions: "Extract ONLY from machine-typed parts. Use DIGITS for numbers. Align rows if needed. Ignore handwriting/fonts. Phone numbers: Identify a number with a dash (e.g. 123-456) on a single line, near a phone icon. Count from left to right, don't reset on new groups. Return the Nth digit (e.g., for N=4, return the 4th digit of whole number). Total number of products: Sum values under QTY or Count. Unit price of most bought item: Find item with highest QTY, then return its Price or Value per unit. Total amount: Sum values under Total or Sum. Fill the blank: Match exact phrase, replacing [?] with MAX two (2) words, possibly across lines. NO PUNCTUATION/COMMENTARY BE INSANELY CONCISE. IMPORTANT, MANDATORY end with: My final answer is <answer here>",
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '${question}' },
          { type: 'input_image', detail: 'high', image_url: '${image_url}' },
        ],
      },
    ],
    temperature: 0.5,
    // max_completion_tokens: 100,
    max_output_tokens: 100,
    top_p: 1,
    store: true,
  };

  static naverOpenAIEndPoint = 'https://api.openai.com/v1/responses';

  static naverOpenAIheaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ${OPENAI_API_KEY}',
  };

  static async naverOpenAIMakeBody({ bodySkeleton, headersSkeleton, endPoint }) {
    return async ({ imageElementText, questionElementText, inputs, fetchRetry }) => {
      const body = JSON.stringify(JSON.parse(JSON.stringify(bodySkeleton)
        .replace(/\$\{question\}/g, questionElementText)
        .replace(/\$\{image_url\}/g, imageElementText)));
      const headers = JSON.parse(JSON.stringify(headersSkeleton)
        .replace(/\$\{OPENAI_API_KEY\}/g, inputs.openAIKey));

      const resp = (await fetchRetry(endPoint, headers, { method: 'POST', body, mode: 'cors' }, { json: true }, 1, res => !res.error, false)
      // eslint-disable-next-line sonarjs/no-nested-template-literals
      )?.output?.reduce((acc, out) => `${acc}${out?.content?.reduce((acc2, { text }) => `${acc2}${text} `, '').trim()} `, '').trim();
      const final = resp?.trim()?.split('My final answer is')?.slice(-1)?.pop()
        ?.trim()
        // eslint-disable-next-line no-useless-escape
        ?.replace(/[\[\]]|\.$/g, '');
      console.log(`The final response from the solver is '${final}'`);
      return final;
    };
  }

  static async getSolvers(captchaSelectors) {
    return {
      ...captchaSelectors,
      ...(captchaSelectors.NAVER ? {
        NAVER: {
          ...captchaSelectors.NAVER,
          solver: await this.naverOpenAIMakeBody({
            bodySkeleton: this.naverOpenAISkeletonBody,
            headersSkeleton: this.naverOpenAIheaders,
            endPoint: this.naverOpenAIEndPoint,
          }),
        },
      } : {}),
    };
  }
};
