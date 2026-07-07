import type { DealQuoteDocument } from '../types';

export function quoteNetPrice(quote: DealQuoteDocument) {
  return Math.max(quote.price - quote.discount + quote.fees + quote.accessories - quote.tradeIn, 0);
}
