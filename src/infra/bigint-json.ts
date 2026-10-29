// `numeric_id` columns are Prisma `BigInt`, which JSON.stringify (and thus
// Express's res.json) throws on by default. Patching toJSON once, globally,
// at process startup covers every route and worker job without each one
// having to remember to convert it.
declare global {
  interface BigInt {
    toJSON(): string;
  }
}

BigInt.prototype.toJSON = function (this: bigint) {
  return this.toString();
};

export {};
