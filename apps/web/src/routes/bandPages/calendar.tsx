// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { Calendar } from '../../pages/Calendar';

export default function CalendarRoute() {
  return <KeyedByBandId Component={Calendar} />;
}
