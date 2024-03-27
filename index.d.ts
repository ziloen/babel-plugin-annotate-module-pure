/**
 * @typedef {Record<string, (string | string[])[]>} PureCalls
 * @typedef {{ pureCalls: PureCalls }} Options plugin options
 */
/**
 * Annotate module methods as pure.
 *
 * @returns {import("@babel/core").PluginObj}
 */
export default function annotateModulePure(): import("@babel/core").PluginObj;
export type PureCalls = Record<string, (string | string[])[]>;
/**
 * plugin options
 */
export type Options = {
    pureCalls: PureCalls;
};
