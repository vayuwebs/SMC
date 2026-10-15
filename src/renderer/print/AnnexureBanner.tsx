import type { JSX } from "react";
import type { FinancialYearDto, SchoolDto } from "../../shared/api.js";
import { formatSchoolTitle, toGujaratiDigits } from "../../lib/gujarati.js";
import { Text } from "./layout-context.js";

/**
 * The stacked heading both annexures carry (SPEC 6.8 and 6.9).
 *
 * Programme lines, the annexure number, the year, then the school and bank
 * identification rows. Shared so the two forms cannot drift apart - they are
 * meant to look like the same document with a different number on it.
 */
export function AnnexureBanner({
  school,
  year,
  numberGu,
}: {
  school: SchoolDto;
  year: FinancialYearDto;
  /** "૯" or "૧૦". */
  numberGu: string;
}): JSX.Element {
  const yearLabel = toGujaratiDigits(
    `${year.startDate.slice(0, 4)} / ${year.endDate.slice(0, 4)}`,
  );
  const [line1 = "", line2 = ""] = school.programmeGu.split(/\s*\/\s*|\n/);

  return (
    <table className="banner" data-part="banner">
      <tbody>
        <tr data-part="bannerProgramme">
          <td colSpan={4} className="banner-title">
            <Text id="part:bannerProgramme">{line1}</Text>
          </td>
        </tr>
        {line2 && (
          <tr data-part="bannerProgramme">
            <td colSpan={4}>
              <Text id="part:bannerProgramme2">{line2}</Text>
            </td>
          </tr>
        )}
        <tr data-part="bannerNumber">
          <td colSpan={4}>
            <Text id="part:bannerNumber">{`પરિશિષ્ટ –: ${numberGu}`}</Text>
          </td>
        </tr>
        <tr data-part="bannerYear">
          <td colSpan={4}>
            <Text id="part:bannerYear">{`વર્ષ –: ${yearLabel}`}</Text>
          </td>
        </tr>
        <tr>
          <td className="label" data-part="bannerSchoolLabel">
            <Text id="part:bannerSchoolLabel">શાળાનું નામ –:</Text>
          </td>
          <td className="value" data-part="bannerSchool">
            <Text id="part:bannerSchool">{formatSchoolTitle(school.nameGu)}</Text>
          </td>
          <td className="label" data-part="bannerDiseLabel">
            <Text id="part:bannerDiseLabel">ડાયસ કોડ–:</Text>
          </td>
          {/* An identifier, not a quantity - Latin digits, as on the original. */}
          <td className="value" data-part="bannerDise">{school.diseCode}</td>
        </tr>
        <tr>
          <td className="label" data-part="bannerClusterLabel">
            <Text id="part:bannerClusterLabel">કલસ્ટર –:</Text>
          </td>
          <td className="value" data-part="bannerCluster">
            <Text id="part:bannerCluster">{school.clusterGu}</Text>
          </td>
          <td className="label" data-part="bannerTalukaLabel">
            <Text id="part:bannerTalukaLabel">તાલુકો–:</Text>
          </td>
          <td className="value" data-part="bannerTaluka">
            <Text id="part:bannerTaluka">{school.talukaGu}</Text>
          </td>
        </tr>
        <tr>
          <td className="label" data-part="bannerAccountLabel">
            <Text id="part:bannerAccountLabel">{`${bankShortName(school.bankNameGu)} ખાતા નંબર –:`}</Text>
          </td>
          <td className="value" colSpan={3} data-part="bannerAccount">
            {school.bankAccountNo}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/**
 * The short name a form prints before "ખાતા નંબર": "Bank of Baroda (BOB)" is
 * BOB, as the forms have always said - and another school's bank is its own,
 * the letters in brackets when its name has them, else the name as entered.
 */
export function bankShortName(bankNameGu: string): string {
  const inBrackets = bankNameGu.match(/\(([^()]+)\)\s*$/)?.[1]?.trim();
  return inBrackets || bankNameGu.trim() || "બેંક";
}
