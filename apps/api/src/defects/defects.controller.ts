import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post } from "@nestjs/common";
import { defectReportOf, defectStatusOf } from "@open-qa-stack/domain";
import type { DefectList, ListedDefect } from "@open-qa-stack/domain/sessions";
import { Defects } from "@open-qa-stack/engine";

/**
 * `GET /defects`, `POST /defects` and `PATCH /defects/:id`: the operations of the defects a person reports from a test
 * that failed, said in HTTP. A defect is named by its reference, such as `D-12`.
 */
@Controller("defects")
export class DefectsController {
  readonly #defects: Defects;

  constructor(defects: Defects) {
    this.#defects = defects;
  }

  /** @returns The defects, the latest reported first, and how many each view holds, which no cache may keep. */
  @Get()
  @Header("Cache-Control", "no-store")
  list(): Promise<DefectList> {
    return this.#defects.list();
  }

  /** @returns The defect kept, open; `invalid_request` for a body that is no report. */
  @Post()
  @Header("Cache-Control", "no-store")
  report(@Body() body: unknown): Promise<ListedDefect> {
    const report = defectReportOf(body);
    if (typeof report === "string") throw new BadRequestException(report);
    return this.#defects.report(report);
  }

  /** @returns The defect as it stands once moved; `unknown_defect` for a reference the instance keeps none of. */
  @Patch(":id")
  @Header("Cache-Control", "no-store")
  change(@Param("id") id: string, @Body() body: unknown): Promise<ListedDefect> {
    const change = defectStatusOf(body);
    if (typeof change === "string") throw new BadRequestException(change);
    return this.#defects.change(id, change.status);
  }
}
