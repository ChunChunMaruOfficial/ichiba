import type { Tool } from '../types.js';
import { accountSettings } from './account.js';
import { cleanFavorites, clearCart, unfollow } from './buyer.js';
import { cancelAuction, deleteListing, markSold, offerLikers } from './confirm.js';
import { answerOffer, answerRequest, handedOver } from './deals.js';
import { editListing, setBargaining } from './edit.js';
import { bump, hide, unhide } from './listings.js';
import { setPrice } from './price.js';
import { help, myListings, pending, shopStats } from './read.js';

/**
 * Everything the assistant can do on an account. What is not here it cannot do: deleting the account, signing out,
 * buying, «Я получил», a dispute, a review, the phone number, messages to other people — for those the chat gives a
 * link and the person does it themselves.
 */
export const TOOLS = [
  myListings,
  shopStats,
  pending,
  help,
  setPrice,
  bump,
  hide,
  unhide,
  setBargaining,
  editListing,
  accountSettings,
  cleanFavorites,
  clearCart,
  unfollow,
  markSold,
  deleteListing,
  answerRequest,
  answerOffer,
  handedOver,
  offerLikers,
  cancelAuction,
] as Tool[];

export const toolByName = (name: string) => TOOLS.find((t) => t.name === name);
