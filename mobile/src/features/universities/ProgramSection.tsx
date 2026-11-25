// «Программы вуза» на странице вуза: заголовок, пояснение, если выбор закрыт, и карточка на каждую программу с наборами. Вынесен
// из UniversityScreen.tsx без изменений.
import { View } from "react-native";

import type { UniversityProgram } from "@web/lib/platform-university-catalog";
import type { StudentUniversityDetail } from "@web/lib/portal/university-index";
import { universityLevelKey } from "@web/lib/portal/universities";

import { usePortalApi } from "@/api/PortalApi";
import { useLang } from "@/i18n/LangProvider";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

import { ExternalLink } from "./ExternalLink";
import { IntakeSelect } from "./IntakeSelect";
import type { UniversityStrings } from "./model";

export function ProgramSection({ detail, strings, now }: { detail: StudentUniversityDetail; strings: UniversityStrings; now: Date }) {
  const { m } = useLang();
  const { canSelectPrograms, studentCaseId } = usePortalApi();
  const listKnown = detail.preparations?.studentCaseId === studentCaseId;
  return (
    <View style={{ gap: 12 }}>
      <Text variant="heading" accessibilityRole="header">
        {m("uni.programsHeading")}
      </Text>
      {listKnown && !canSelectPrograms ? (
        <Text variant="caption" tone="text2">
          {m("programs.caseIneligible")}
        </Text>
      ) : null}
      {detail.university.content.programs.map((program) => (
        <ProgramCard key={program.id} program={program} detail={detail} strings={strings} now={now} />
      ))}
    </View>
  );
}

function ProgramCard({ program, detail, strings, now }: { program: UniversityProgram; detail: StudentUniversityDetail; strings: UniversityStrings; now: Date }) {
  const { lang } = useLang();
  return (
    <Card>
      <Text variant="caption" tone="text2" bold>
        {strings[universityLevelKey(program.level)]}
      </Text>
      <Text variant="heading">{program.title}</Text>
      {program.duration ? (
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.duration}:{" "}
          </Text>
          {program.duration}
        </Text>
      ) : null}
      {program.language ? (
        <Text variant="secondary">
          <Text variant="secondary" tone="text2">
            {strings.teachingLanguage}:{" "}
          </Text>
          {program.language}
        </Text>
      ) : null}
      {program.summary ? <Text variant="secondary">{program.summary}</Text> : null}
      <ExternalLink url={program.sourceUrl} label={strings.programPage} />
      {program.intakes.map((intake, index) => (
        <IntakeSelect key={intake.id ?? index} intake={intake} program={program} detail={detail} strings={strings} now={now} lang={lang} />
      ))}
    </Card>
  );
}
