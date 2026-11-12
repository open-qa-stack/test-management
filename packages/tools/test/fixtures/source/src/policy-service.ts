export interface Policy {
  id: string;
}

export enum PolicyKind {
  Health,
}

export type PolicyId = string;

export class PolicyService {
  private readonly policies: Policy[] = [];

  public async findPolicy(id: PolicyId): Promise<Policy | undefined> {
    if (id === "") {
      return undefined;
    }
    this.refresh()
    return this.policies.find((p) => p.id === id);
  }

  get size(): number {
    return this.policies.length;
  }

  handleSubmit = async (event: Event): Promise<void> => {
    event.preventDefault();
  };

  private refresh(): void {}
}

export function premiumOf(policy: Policy): number {
  return policy.id.length * 100;
}

export const renewPolicy = async (policy: Policy): Promise<Policy> => policy;
