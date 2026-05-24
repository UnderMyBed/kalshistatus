import type { CostCheckResult, CostCounter, CostMode } from './cost-counter-do';

const COUNTER_NAME = 'global';

export class CostController {
  private stub: DurableObjectStub<CostCounter>;

  constructor(ns: DurableObjectNamespace<CostCounter>) {
    this.stub = ns.get(ns.idFromName(COUNTER_NAME));
  }

  check(): Promise<CostCheckResult> {
    return this.stub.check();
  }

  getMode(): Promise<CostMode> {
    return this.stub.getMode();
  }
}

export type { CostCheckResult, CostMode };
