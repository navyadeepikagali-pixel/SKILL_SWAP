export function activeAccountFilter() {
  return {
    accountStatus: "active",
    $or: [
      { isEmailVerified: true },
      { emailVerificationRequired: false }
    ]
  };
}
