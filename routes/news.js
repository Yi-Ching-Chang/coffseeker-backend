import express from 'express'
const router = express.Router()
import pool from '../config/db.js'

import { readJsonFile } from '../utils/json-tool.js'

import {
  getNews,
  getNewsWithQS,
  getNewsById,
  countWithQS,
} from '../models/news.js'
// 專用處理sql字串的工具，主要format與escape，防止sql injection
import sqlString from 'sqlstring'
import { body } from 'express-validator'

// 獲得所有資料，加入分頁與搜尋字串功能，單一資料表處理
// products/qs?page=1&keyword=xxxx&cat_ids=1,2&sizes=1,2&tags=3,4&colors=1,2,3&orderby=id,asc&perpage=10&price_range=1500,10000
router.get('/qs', async (req, res, next) => {
  // 獲取網頁的搜尋字串
  const {
    page,
    keyword,
    cat_ids,
    colors,
    tags,
    sizes,
    orderby,
    perpage,
    price_range,
  } = req.query

  // TODO: 這裡可以檢查各query string正確性或給預設值，檢查不足可能會產生查詢錯誤

  // 建立資料庫搜尋條件
  const conditions = []

  // 關鍵字 keyword 使用 `name LIKE '%keyword%'`
  conditions[0] = keyword
    ? `name LIKE ${sqlString.escape('%' + keyword + '%')}`
    : ''

  // 分類，cat_id 使用 `cat_id IN (1, 2, 3, 4, 5)`
  conditions[1] = cat_ids ? `cat_id IN (${cat_ids})` : ''

  // 顏色: FIND_IN_SET(1, color) OR FIND_IN_SET(2, color)
  const color_ids = colors ? colors.split(',') : []
  conditions[2] = color_ids
    .map((v) => `FIND_IN_SET(${Number(v)}, color)`)
    .join(' OR ')

  //  標籤: FIND_IN_SET(3, tag) OR FIND_IN_SET(2, tag)
  const tag_ids = tags ? tags.split(',') : []
  conditions[3] = tag_ids
    .map((v) => `FIND_IN_SET(${Number(v)}, tag)`)
    .join(' OR ')

  //  尺寸: FIND_IN_SET(3, size) OR FIND_IN_SET(2, size)
  const size_ids = sizes ? sizes.split(',') : []
  conditions[4] = size_ids
    .map((v) => `FIND_IN_SET(${Number(v)}, size)`)
    .join(' OR ')

  // 價格
  const priceRanges = price_range ? price_range.split(',') : []
  const min = Number(priceRanges[0])
  const max = Number(priceRanges[1])
  // 價格要介於1500~10000間
  if (min >= 1500 && max <= 10000) {
    conditions[5] = `price BETWEEN ${min} AND ${max}`
  }

  //各條件為AND相接(不存在時不加入where從句中)
  const conditionsValues = conditions.filter((v) => v)

  // 各條件需要先包含在`()`中，因各自內查詢是OR, 與其它的是AND
  const where =
    conditionsValues.length > 0
      ? `WHERE ` + conditionsValues.map((v) => `( ${v} )`).join(' AND ')
      : ''

  // 分頁用
  // page預設為1，perpage預設為10
  const perpageNow = Number(perpage) || 10
  const pageNow = Number(page) || 1
  const limit = perpageNow
  // page=1 offset=0 ; page=2 offset= perpage * 1; ...
  const offset = (pageNow - 1) * perpageNow

  // 排序用，預設使用id, asc
  const order = orderby
    ? { [orderby.split(',')[0]]: orderby.split(',')[1] }
    : { id: 'asc' }

  // 查詢
  const total = await countWithQS(where)
  const news = await getNewsWithQS(where, order, limit, offset)

  // json回傳範例
  //
  // {
  //   total: 100,
  //   perpage: 10,
  //   page: 1,
  //   data:[
  //     {id:123, name:'',...},
  //     {id:123, name:'',...}
  //   ]
  // }

  const result = {
    total,
    perpage: Number(perpage),
    page: Number(page),
    data: news,
  }

  res.json(result)
})

router.get('/', async (req, res, next) => {
  // 讀入所有消息資料
  const allNews = await getNews()

  // 分頁相關變數
  const perpage = Number(req.query.perpage) || 6 // 每頁顯示的消息數，預設為 10
  const page = Number(req.query.page) || 1 // 當前頁數，預設為 1

  // 計算 limit 和 offset
  const limit = perpage
  const offset = (page - 1) * perpage

  // 從所有消息中切割出當前頁面應該顯示的消息
  const news = allNews.slice(offset, offset + perpage)
  const totalPages = Math.ceil(allNews.length / perpage)

  return res.json({
    message: 'success',
    code: '200',
    news,
    currentPage: page,
    totalPages,
  })
})

router.get('/category/:cid', async (req, res, next) => {
  try {
    const cid = req.params.cid

    // 確保 cid 是一個有效的數字值
    if (isNaN(parseInt(cid))) {
      return res.status(400).json({ error: '無效的 cid' })
    }

    // 使用分頁相關變數
    const perpageNow = Number(req.query.perpage) || 6 // 每頁顯示的消息數
    const pageNow = Number(req.query.page) || 1 // 當前頁數

    // 計算偏移量
    const offset = (pageNow - 1) * perpageNow

    let categoryId = 0 // 預設的 category_id

    // 根據不同的 cid 值設定 categoryId
    switch (cid) {
      case '1':
        categoryId = 1
        break
      case '2':
        categoryId = 2
        break
      case '3':
        categoryId = 3
        break
      default:
        categoryId = 0
        break
    }

    if (categoryId === 0) {
      return res.status(404).json({ error: '找不到相應分類的消息' })
    }

    // 修正的 SQL 查詢
    const query = `
    SELECT * FROM news 
    WHERE category_id = ? 
    LIMIT ? OFFSET ?
  `

    const [rows, fields] = await pool.execute(query, [
      categoryId,
      perpageNow,
      offset,
    ])

    // 檢查是否找到相應分類的消息
    if (rows.length === 0) {
      return res.status(404).json({ error: '找不到相應分類的消息' })
    }

    // 若有找到對應消息則返回給前端
    const news = rows
    res.json(news)
  } catch (error) {
    console.error('資料獲取失敗:', error.message)
    res.status(500).json({ error: '資料獲取失敗，請重試。' })
  }
})

// 獲得單筆消息
router.get('/:nid', async (req, res, next) => {
  try {
    const nid = req.params.nid

    // 確保 nid 是一個有效的數字值
    if (isNaN(parseInt(nid))) {
      throw new Error('無效的 nid')
    }

    //news資料表查詢
    const query = 'SELECT * FROM news WHERE news_id = ?'
    const [rows, fields] = await pool.execute(query, [nid])

    // 檢查是否找到相應的消息
    if (rows.length === 0) {
      return res.status(404).json({ error: '找不到相應的新聞' })
    }

    //若有找到對應消息則返回給前端
    const news = rows[0]
    res.json(news)
  } catch (error) {
    console.error('資料獲取失敗:', error.message)
    res.status(500).json({ error: '資料獲取失敗，請重試。' })
  }
})

export default router