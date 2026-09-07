// SPDX-License-Identifier: Apache-2.0
import { KeyedByBandId } from '../../components/KeyedByBandId';
import { EventDetail } from '../../pages/EventDetail';

export default function EventDetailRoute() {
  return <KeyedByBandId Component={EventDetail} />;
}
