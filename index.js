import puppeteer from "puppeteer";
import xlsx from "xlsx";
import fs from "fs";

const CATEGORY_URL = "https://www.jomashop.com/watches.html";
const PAGE_URL = "https://www.jomashop.com";

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100; // Khoảng cách cuộn mỗi lần
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100); // Thời gian chờ giữa mỗi lần cuộn
    });
  });
}

async function scrapeData() {
  const browser = await puppeteer.launch({ headless: true }); // Hiển thị trình duyệt
  const page = await browser.newPage();
  await page.goto(CATEGORY_URL, { waitUntil: "networkidle2" });

  // Duyệt qua từng link sản phẩm để crawl thông tin chi tiết
  let products = [];
  let currentPageUrl = CATEGORY_URL;
  let hasNextPage = true;

  while (hasNextPage && products.length < 500) {
    // Lấy danh sách link sản phẩm từ trang danh mục
    const productLinks = await page.evaluate(() => {
      const productElements = document.querySelectorAll(".productItemBlock");

      return [...productElements].map((product) => product.getAttribute("data-scroll-target"));
    });

    console.log(`Tìm thấy ${productLinks.length} sản phẩm.`);

    for (let i = 0; i < productLinks.length; i++) {
      try {
        const productUrl = PAGE_URL + productLinks[i];
        console.log(`Đang crawl sản phẩm ${i + 1}/${productLinks.length}: ${productUrl}`);

        const productPage = await browser.newPage();
        await productPage.goto(productUrl, { waitUntil: "networkidle2" });
        await autoScroll(productPage);

        const product = await productPage.evaluate((url) => {
          const productInfo = document.querySelector(".product-info-main");

          function extractNumbers(inputString) {
            if (!inputString) return null;
            const numbers = inputString.match(/\d+/g);
            return numbers ? numbers.join("") : "";
          }
          
          const name = productInfo?.querySelector(".product-name")?.innerText || "Không có tên sản phẩm";
          const brand = productInfo.querySelector(".brand-name")?.innerText.trim() || "Không có dữ liệu thương hiệu";
          const sku = productInfo?.querySelector(".product-info-stock-sku")?.innerText || "Không có SKU";
          const description = productInfo.querySelector(".show-more-text-content")?.innerText || "Không có mô tả";
          const price = extractNumbers(productInfo?.querySelector(".now-price")?.innerText) || "Không có giá";
          const salePrice =
            extractNumbers(productInfo?.querySelector(".was-wrapper")?.innerText) || "Không có giá sale";
          const rating =
            extractNumbers(document.querySelector(".yotpo-display-wrapper a")?.innerText) || "Không có đánh giá";
          const avgRating =  document.querySelector(".avg-score.font-color-gray-darker")?.innerText || "Không có đánh giá trung bình";
          const images = [...document.querySelectorAll(".thumbs-items-wrapper.simple-slider-wrapper img")]
            .map((img) => img.getAttribute("src"))
            .join(", ");

          return {
            name,
            brand,
            sku,
            description,
            price,
            salePrice,
            rating,
            avgRating,
            images,
            url,
          };
        }, productUrl);

        products.push(product);

        // Lặp qua từng phần tử con của .more-detail-body
        await productPage.close();
      } catch (error) {
        console.error(`Lỗi khi crawl sản phẩm: `, error);
      }
    }

    // Kiểm tra và chuyển sang trang tiếp theo nếu có
    try {
      const nextPageUrl = await page.evaluate(() => {
        const nextButton = document.querySelector(".pagination-next.page-item a.page-link");
        return nextButton ? nextButton.getAttribute("href") : null;
      });

      if (nextPageUrl) {
        currentPageUrl = PAGE_URL + nextPageUrl;
        await page.goto(currentPageUrl, { waitUntil: "networkidle2" });
      } else {
        hasNextPage = false; // Không còn trang tiếp theo
      }
    } catch (error) {
      console.error("Lỗi khi chuyển trang:", error);
      hasNextPage = false;
    }
  }
  await browser.close();
  return products;
}

async function exportToExcel(data) {
  const worksheet = xlsx.utils.json_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Danh sách sản phẩm");
  const filePath = "./JomaWatches.xlsx";
  xlsx.writeFile(workbook, filePath);
  console.log(`Dữ liệu đã được xuất ra file ${filePath}`);
}

(async () => {
  try {
    const data = await scrapeData();
    await exportToExcel(data);
  } catch (error) {
    console.error("Lỗi trong quá trình crawl dữ liệu:", error);
  }
})();
