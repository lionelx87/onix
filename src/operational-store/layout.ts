export type OperationalStoreLayout = {
  root: string;
  versioned: {
    config: string;
    classificationRules: string;
  };
  transient: {
    activeSession: string;
    vaultIndexes: string;
    patchPlans: string;
    approvalState: string;
    logs: string;
    cache: string;
  };
};

export function storeLayout(root: string): OperationalStoreLayout {
  return {
    root,
    versioned: {
      config: `${root}/config.json`,
      classificationRules: `${root}/classification-rules.json`
    },
    transient: {
      activeSession: `${root}/state/active-session.json`,
      vaultIndexes: `${root}/indexes/`,
      patchPlans: `${root}/plans/`,
      approvalState: `${root}/approvals/`,
      logs: `${root}/logs/`,
      cache: `${root}/cache/`
    }
  };
}
