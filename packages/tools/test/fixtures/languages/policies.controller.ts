@Controller("policies")
export class PoliciesController {
  constructor(private readonly service: PolicyService) {}

  @Get(":id")
  findOne(@Param("id") id: string): Policy {
    return this.service.find(id);
  }

  handle = async (event: Event) => {};
}
export interface Policy { id: string }
export type PolicyId = string;
export const renew = (p: Policy) => p;
function local() {}
