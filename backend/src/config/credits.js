export function sessionCreditPrice() {
  const configured = process.env.SESSION_CREDIT_PRICE ?? "10";
  const price = Number(configured);
  if (!Number.isSafeInteger(price) || price < 1 || price > 100_000) {
    throw new Error("SESSION_CREDIT_PRICE must be a positive integer no greater than 100000");
  }
  return price;
}
