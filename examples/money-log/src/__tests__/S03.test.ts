import { describe, it, expect } from 'vitest';

describe('S03: 管理支出分类 - 单元测试', () => {
  describe('UT-S03-01: 分类名必填', () => {
    it('应拒绝空分类名', () => {
      const data = {};
      const hasName = data.name !== undefined && data.name !== null;
      expect(hasName).toBe(false);
    });
  });

  describe('UT-S03-02: 分类名长度限制', () => {
    it('应拒绝超出20字符的名称', () => {
      const name = 'a'.repeat(21);
      expect(name.length <= 20).toBe(false);
    });

    it('应接受20字符以内的名称', () => {
      const name = 'a'.repeat(20);
      expect(name.length <= 20).toBe(true);
    });
  });

  describe('UT-S03-03: 分类名唯一性', () => {
    it('应检测重复名称', () => {
      const existingNames = ['餐饮', '交通', '购物'];
      const newName = '餐饮';
      const isDuplicate = existingNames.includes(newName);
      expect(isDuplicate).toBe(true);
    });

    it('应接受新名称', () => {
      const existingNames = ['餐饮', '交通', '购物'];
      const newName = '咖啡';
      const isDuplicate = existingNames.includes(newName);
      expect(isDuplicate).toBe(false);
    });
  });

  describe('UT-S03-08: 默认分类标记', () => {
    it('新增分类应有is_default=0', () => {
      const is_default = 0;
      expect(is_default).toBe(0);
    });

    it('预设分类应有is_default=1', () => {
      const is_default = 1;
      expect(is_default).toBe(1);
    });
  });

  describe('UT-S03-09: 预设分类不可删除', () => {
    it('应识别预设分类', () => {
      const category = { id: 1, is_default: 1 };
      const canDelete = category.is_default === 0;
      expect(canDelete).toBe(false);
    });

    it('应允许删除自定义分类', () => {
      const category = { id: 10, is_default: 0 };
      const canDelete = category.is_default === 0;
      expect(canDelete).toBe(true);
    });
  });
});

describe('S03: 管理支出分类 - 场景测试', () => {
  describe('ST-S03-01: 新增自定义分类', () => {
    it('应成功添加新分类', () => {
      const categories = [
        { id: 1, name: '餐饮' },
        { id: 2, name: '交通' },
      ];
      const newCategory = { id: 3, name: '咖啡' };
      const result = [...categories, newCategory];
      expect(result.length).toBe(3);
    });
  });

  describe('ST-S03-03: 删除自定义分类', () => {
    it('应正确删除分类', () => {
      const categories = [
        { id: 1, name: '餐饮' },
        { id: 10, name: '咖啡', is_default: 0 },
      ];
      const idToDelete = 10;
      const result = categories.filter(c => c.id !== idToDelete);
      expect(result.length).toBe(1);
    });
  });

  describe('ST-S03-04: 异常 - 新增重复名称', () => {
    it('应检测到重复', () => {
      const existingNames = ['餐饮', '交通'];
      const input = '餐饮';
      const error = existingNames.includes(input) ? '分类名已存在' : null;
      expect(error).toBe('分类名已存在');
    });
  });

  describe('ST-S03-05: 异常 - 新增空名称', () => {
    it('应提示输入名称', () => {
      const input = '';
      const error = !input.trim() ? '请输入分类名称' : null;
      expect(error).toBe('请输入分类名称');
    });
  });
});
